/** Reporting timezone helpers. Every month bucket in the money views is a Denver calendar month. */
export const REPORTING_TZ = "America/Denver";

const dtf = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORTING_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function parts(d: Date) {
  const o: Record<string, number> = {};
  for (const p of dtf.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** "YYYY-MM" of the Denver calendar month containing this instant. */
export function denverMonthOf(d: Date): string {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" of the Denver calendar day containing this instant. */
export function denverDayOf(d: Date): string {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset (local − UTC, ms) of Denver at the instant `utcMs`. */
function offsetMs(utcMs: number): number {
  const p = parts(new Date(utcMs));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of Denver local midnight starting the given month ("YYYY-MM"). DST changes happen at 02:00, so midnight is unambiguous. */
export function denverMonthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, 1);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return new Date(t);
}

/** The UTC instant of Denver local midnight starting the given day ("YYYY-MM-DD"). Same DST handling as denverMonthStart. */
export function denverDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return new Date(t);
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (s: unknown): s is string => typeof s === "string" && MONTH_RE.test(s);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive list of months. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Half-open UTC bounds [from, to) covering Denver months fromMonth..toMonth inclusive. */
export function monthRangeBounds(fromMonth: string, toMonth: string): { from: Date; to: Date } {
  return { from: denverMonthStart(fromMonth), to: denverMonthStart(addMonths(toMonth, 1)) };
}

/** SQL for a Denver "YYYY-MM" bucket of a `timestamp without time zone` column that stores UTC (Prisma DateTime). */
export const sqlDenverMonth = (col: string): string => `to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver', 'YYYY-MM')`;

export const currentDenverMonth = (now = new Date()): string => denverMonthOf(now);

/** "YYYY-MM-DD HH:mm:ss" in Denver local time (for CSV columns next to the UTC ISO column). */
export function denverStamp(d: Date): string {
  const p = parts(d);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)} ${z(p.hour)}:${z(p.minute)}:${z(p.second)}`;
}
