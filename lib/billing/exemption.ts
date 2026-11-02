/**
 * Pure helpers for scripts/billing/set-exemption.ts (special-account exemption, replaces the old coverage override).
 * `exemptUntil` is EXCLUSIVE — the account is exempt while now < exemptUntil, so "--until 2026-11-21" exempts through Nov 20 and the
 * exemption ends at 00:00 America/Denver on Nov 21. While exempt the engine takes no adverse automatic action (docs/dunning-engine.md).
 */
const TZ = "America/Denver";
const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function offsetMs(utcMs: number): number {
  const o: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of Denver local midnight starting `date` ("YYYY-MM-DD"); null if it isn't a real calendar date. */
export function denverDateToInstant(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const guess = Date.UTC(y, mo - 1, d);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t); // DST changes at 02:00, so midnight is unambiguous
  return new Date(t);
}

export type ExemptionPlan = { locationId: string } & ({ clear: true } | { clear: false; until: Date; reason: string });

export type ParseResult = { ok: true; plan: ExemptionPlan; warnings: string[] } | { ok: false; error: string };

/** `has` reports a bare flag (--clear); `get` reads --name=value. */
export function parseExemptionOptions(get: (name: string) => string | undefined, has: (name: string) => boolean): ParseResult {
  const locationId = get("location-id");
  if (!locationId || !/^[A-Za-z0-9]{10,64}$/.test(locationId)) return { ok: false, error: "--location-id=<full GHL location id> is required" };
  const until = get("until");
  const reason = get("reason");
  if (has("clear")) {
    if (until !== undefined || reason !== undefined) return { ok: false, error: "--clear cannot be combined with --until or --reason" };
    return { ok: true, plan: { locationId, clear: true }, warnings: [] };
  }
  if (until === undefined) return { ok: false, error: "give --until=YYYY-MM-DD (America/Denver, exclusive) and --reason=\"…\", or --clear" };
  const d = denverDateToInstant(until);
  if (!d) return { ok: false, error: `--until must be a real date as YYYY-MM-DD (America/Denver), got "${until}"` };
  if (!reason || !reason.trim()) return { ok: false, error: "--reason=\"…\" is required with --until (it is shown on the dashboard)" };
  if (reason.length > 500) return { ok: false, error: "--reason must be 500 characters or fewer" };
  const warnings: string[] = [];
  if (d.getTime() <= Date.now()) warnings.push("--until is in the past: this account would not be exempt");
  return { ok: true, plan: { locationId, clear: false, until: d, reason: reason.trim() }, warnings };
}

export type ExemptionSnapshot = { exemptUntil: Date | null; exemptReason: string | null };

/** The fields to write for a plan. */
export function exemptionUpdate(plan: ExemptionPlan): ExemptionSnapshot {
  return plan.clear ? { exemptUntil: null, exemptReason: null } : { exemptUntil: plan.until, exemptReason: plan.reason };
}

export function diffExemption(before: ExemptionSnapshot, after: ExemptionSnapshot): { field: keyof ExemptionSnapshot; before: string; after: string; changed: boolean }[] {
  const show = (v: unknown) => (v === null || v === undefined ? "(none)" : v instanceof Date ? v.toISOString() : String(v));
  return (Object.keys(before) as (keyof ExemptionSnapshot)[]).map((field) => ({ field, before: show(before[field]), after: show(after[field]), changed: show(before[field]) !== show(after[field]) }));
}
