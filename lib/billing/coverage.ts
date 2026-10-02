import type { BillingState, PauseReason } from "@prisma/client";

/**
 * Pure helpers for scripts/billing/set-coverage.ts (manual core-subscription coverage override).
 * Coverage semantics: `coreCoveredUntil` is EXCLUSIVE — the account is covered while now < coreCoveredUntil, so "--until
 * 2026-11-21" covers through Nov 20 and coverage ends at 00:00 America/Denver on Nov 21 (the day the next charge is due).
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

export const BILLING_STATES: BillingState[] = ["trial", "active", "payment_failed", "paused", "inactive", "churned"];
export const PAUSE_REASONS: PauseReason[] = ["non_payment", "expired_invoice", "voluntary", "manual_killswitch"];

export type CoveragePlan = {
  locationId: string;
  until?: Date;
  note?: string;
  state?: BillingState;
  /** null = clear it ("none"). */
  pauseReason?: PauseReason | null;
  legacyUnreconciled?: boolean;
};

export type ParseResult = { ok: true; plan: CoveragePlan; warnings: string[] } | { ok: false; error: string };

export function parseCoverageOptions(get: (name: string) => string | undefined): ParseResult {
  const locationId = get("location-id");
  if (!locationId || !/^[A-Za-z0-9]{10,64}$/.test(locationId)) return { ok: false, error: "--location-id=<full GHL location id> is required" };
  const plan: CoveragePlan = { locationId };
  const warnings: string[] = [];

  const until = get("until");
  if (until !== undefined) {
    const d = denverDateToInstant(until);
    if (!d) return { ok: false, error: `--until must be a real date as YYYY-MM-DD (America/Denver), got "${until}"` };
    plan.until = d;
  }
  const note = get("note");
  if (note !== undefined) {
    if (note.length > 500) return { ok: false, error: "--note must be 500 characters or fewer" };
    plan.note = note;
  }
  const state = get("state");
  if (state !== undefined) {
    if (!(BILLING_STATES as string[]).includes(state)) return { ok: false, error: `--state must be one of ${BILLING_STATES.join(", ")}` };
    plan.state = state as BillingState;
  }
  const reason = get("pause-reason");
  if (reason !== undefined) {
    if (reason === "none") plan.pauseReason = null;
    else if ((PAUSE_REASONS as string[]).includes(reason)) plan.pauseReason = reason as PauseReason;
    else return { ok: false, error: `--pause-reason must be "none" or one of ${PAUSE_REASONS.join(", ")}` };
  }
  const legacy = get("legacy-unreconciled");
  if (legacy !== undefined) {
    if (legacy !== "true" && legacy !== "false") return { ok: false, error: "--legacy-unreconciled must be true or false" };
    plan.legacyUnreconciled = legacy === "true";
  }

  if (plan.until === undefined && plan.note === undefined && plan.state === undefined && plan.pauseReason === undefined && plan.legacyUnreconciled === undefined) {
    return { ok: false, error: "nothing to change: give at least one of --until, --note, --state, --pause-reason, --legacy-unreconciled" };
  }
  if (plan.note !== undefined && plan.until === undefined) warnings.push("--note without --until: the note is stored, but no coverage date is set or changed");
  if (plan.until && plan.until.getTime() <= Date.now()) warnings.push("--until is in the past: this account would not be covered");
  if (plan.state && plan.state !== "paused" && plan.pauseReason) warnings.push(`pause reason ${plan.pauseReason} on a non-paused state (${plan.state})`);
  return { ok: true, plan, warnings };
}

export type CoverageSnapshot = { billingState: BillingState | null; pauseReason: PauseReason | null; legacyUnreconciled: boolean; coreCoveredUntil: Date | null; coreCoverageNote: string | null };

/** The fields to write for a plan (only what was asked for). */
export function coverageUpdate(plan: CoveragePlan) {
  return {
    ...(plan.until !== undefined ? { coreCoveredUntil: plan.until } : {}),
    ...(plan.note !== undefined ? { coreCoverageNote: plan.note } : {}),
    ...(plan.state !== undefined ? { billingState: plan.state } : {}),
    ...(plan.pauseReason !== undefined ? { pauseReason: plan.pauseReason } : {}),
    ...(plan.legacyUnreconciled !== undefined ? { legacyUnreconciled: plan.legacyUnreconciled } : {}),
  };
}

export function applyPlan(before: CoverageSnapshot, plan: CoveragePlan): CoverageSnapshot {
  return { ...before, ...coverageUpdate(plan) } as CoverageSnapshot;
}

export function diffSnapshots(before: CoverageSnapshot, after: CoverageSnapshot): { field: keyof CoverageSnapshot; before: string; after: string; changed: boolean }[] {
  const show = (v: unknown) => (v === null || v === undefined ? "(none)" : v instanceof Date ? v.toISOString() : String(v));
  return (Object.keys(before) as (keyof CoverageSnapshot)[]).map((field) => ({ field, before: show(before[field]), after: show(after[field]), changed: show(before[field]) !== show(after[field]) }));
}
