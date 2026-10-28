/** Claims are open for FOUNDER_CLAIMS_OPEN_AT <= now < FOUNDER_CLAIMS_CLOSE_AT. A missing or unparseable value fails closed ("unavailable"). */
export type ClaimWindow = "before" | "open" | "closed" | "unavailable";

const parse = (raw: string | undefined): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function claimsOpenAt(env: Record<string, string | undefined> = process.env): Date | null {
  return parse(env.FOUNDER_CLAIMS_OPEN_AT);
}

export function claimWindow(now: Date, env: Record<string, string | undefined> = process.env): ClaimWindow {
  const open = parse(env.FOUNDER_CLAIMS_OPEN_AT);
  const close = parse(env.FOUNDER_CLAIMS_CLOSE_AT);
  if (!open || !close) return "unavailable";
  if (now.getTime() < open.getTime()) return "before";
  return now.getTime() < close.getTime() ? "open" : "closed";
}

/** "Wednesday, Oct 28 at 7 PM CT" in America/Chicago (":30" shown only when the minutes are not zero). */
export function formatOpenTimeCt(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const time = p.minute === "00" ? `${p.hour} ${p.dayPeriod}` : `${p.hour}:${p.minute} ${p.dayPeriod}`;
  return `${p.weekday}, ${p.month} ${p.day} at ${time} CT`;
}
