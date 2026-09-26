import { parseWalletCategory } from "./walletCategories";

/** Integer micro-units (amount × 1e6) so accumulation is exact; the DB column is Decimal(12,6). */
export type Acc = Record<string, { count: number; micros: number }>; // key = `${YYYY-MM-DD}|${category}`

export type WalletTxRow = { id: string; description?: string | null; amount: number; locationName?: string | null; settlementTime: string };

export type RollupRow = { day: string; category: string; count: number; micros: number };

export const toMicros = (amount: number): number => Math.round(amount * 1e6);

/** Exact micros → "-12.345600" string, no float division. */
export function microsToDecimalString(micros: number): string {
  const neg = micros < 0;
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1e6);
  const frac = String(abs % 1e6).padStart(6, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export const utcDay = (settlementTime: string): string => settlementTime.slice(0, 10);

export function addToAcc(acc: Acc, row: WalletTxRow): void {
  const key = `${utcDay(row.settlementTime)}|${parseWalletCategory(row.description)}`;
  const o = (acc[key] ??= { count: 0, micros: 0 });
  o.count += 1;
  o.micros += toMicros(row.amount);
}

export function accToRows(acc: Acc): RollupRow[] {
  return Object.entries(acc).map(([key, v]) => {
    const [day, category] = key.split("|");
    return { day, category, count: v.count, micros: v.micros };
  });
}

/** Scope for a row that no per-location query returned: blank/"-" name → agency-level, otherwise a non-member location. */
export function unfilteredScope(locationName: string | null | undefined): "_agency" | "_unattributed" {
  const n = (locationName ?? "").trim();
  return n === "" || n === "-" ? "_agency" : "_unattributed";
}

/** Inclusive list of UTC days (YYYY-MM-DD) covered by an ISO window. */
export function daysInWindow(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const end = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  for (let t = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10)); t <= end; t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The previous `n` complete UTC days before `now`. */
export function previousUtcWindow(now: Date, n = 2): { from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: new Date(today - n * 864e5).toISOString(), to: new Date(today - 1).toISOString() };
}
