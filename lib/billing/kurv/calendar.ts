/** Pure date-string ("YYYY-MM-DD") calendar math for Kurv deposits. Bank days = weekdays minus US Federal Reserve holidays. */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const toUtc = (day: string) => new Date(`${day}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return fromUtc(new Date(+toUtc(day) + n * 864e5));
}

/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = (day: string): number => toUtc(day).getUTCDay();

/** nth (1-based) given weekday of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, dow: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return ymd(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return ymd(y, m, lastDay - ((last - dow + 7) % 7));
}

/** A Sunday holiday is observed Monday. A Saturday holiday is NOT observed on Friday (the Fed stays open). */
function observed(y: number, m: number, d: number): string | null {
  const day = ymd(y, m, d);
  const dow = dayOfWeek(day);
  if (dow === 6) return null;
  return dow === 0 ? addDays(day, 1) : day;
}

const cache = new Map<number, Set<string>>();

/** Federal Reserve bank holidays whose observed date falls in `year`. */
export function fedHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Set<string>();
  // Fixed-date holidays can be observed in an adjacent year only for Jan 1 (Sat → not observed), so no spillover handling is needed.
  for (const [m, d] of [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]] as const) {
    const o = observed(year, m, d);
    if (o) out.add(o);
  }
  out.add(nthWeekday(year, 1, 1, 3)); // MLK
  out.add(nthWeekday(year, 2, 1, 3)); // Presidents
  out.add(nthWeekday(year, 5, 1, -1)); // Memorial
  out.add(nthWeekday(year, 9, 1, 1)); // Labor
  out.add(nthWeekday(year, 10, 1, 2)); // Columbus / Indigenous Peoples
  out.add(nthWeekday(year, 11, 4, 4)); // Thanksgiving
  cache.set(year, out);
  return out;
}

export function isBankDay(day: string): boolean {
  const dow = dayOfWeek(day);
  if (dow === 0 || dow === 6) return false;
  return !fedHolidays(Number(day.slice(0, 4))).has(day);
}

/** The first bank day strictly after `day`. */
export function nextBankDay(day: string): string {
  let d = addDays(day, 1);
  while (!isBankDay(d)) d = addDays(d, 1);
  return d;
}

/** "YYYY-MM" of a "YYYY-MM-DD". */
export const monthOfDay = (day: string): string => day.slice(0, 7);
