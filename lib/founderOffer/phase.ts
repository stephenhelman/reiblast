export type PromoPhase = "pre" | "open";
export type PhaseResult =
  | { ok: true; phase: PromoPhase; openAt: Date; closeAt: Date }
  | { ok: false; reason: "not_configured" | "offer_closed" };

function parse(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Server clock for the founder promo. FOUNDER_CLAIMS_OPEN_AT / FOUNDER_CLAIMS_CLOSE_AT are read at request time; missing or
 * invalid (or close <= open) fails closed. now < open → pre, open <= now < close → open, otherwise offer_closed.
 */
export function getPromoPhase(now: Date = new Date()): PhaseResult {
  const openAt = parse(process.env.FOUNDER_CLAIMS_OPEN_AT);
  const closeAt = parse(process.env.FOUNDER_CLAIMS_CLOSE_AT);
  if (!openAt || !closeAt || closeAt.getTime() <= openAt.getTime()) return { ok: false, reason: "not_configured" };
  if (now.getTime() >= closeAt.getTime()) return { ok: false, reason: "offer_closed" };
  return { ok: true, phase: now.getTime() < openAt.getTime() ? "pre" : "open", openAt, closeAt };
}

/** America/Chicago "YYYY-MM-DDTHH" (24h) — the discord_tick dedupe key, one post per Central hour. */
export function chicagoRunKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`;
}
