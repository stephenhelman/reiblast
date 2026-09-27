import { Prisma } from "@prisma/client";
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

/** A usable display name: trimmed, not blank and not the "-" GHL puts on agency-level rows. */
export function usableLocationName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n === "" || n === "-" ? null : n;
}

export type SeenName = { name: string; time: string };

/** Folds rows into the most recent (by settlementTime) usable locationName seen so far. Zoneless "YYYY-MM-DD HH:mm:ss.SSS" sorts lexicographically. */
export function latestLocationName(prev: SeenName | null, rows: WalletTxRow[]): SeenName | null {
  let best = prev;
  for (const r of rows) {
    const name = usableLocationName(r.locationName);
    if (name && (!best || r.settlementTime > best.time)) best = { name, time: r.settlementTime };
  }
  return best;
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

/**
 * GHL wallet settlementTime looks like "2026-06-19 08:06:55.147" (space, no zone). The request asks for timezone UTC,
 * so treat it as UTC explicitly — `new Date()` on that string would use the machine's local zone.
 */
export function parseSettlementTime(s: string): Date {
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s.trim()) ? s.trim().replace(" ", "T") : `${s.trim().replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable settlementTime: ${s}`);
  return d;
}

/** WalletTransaction insert payload for one raw GHL row; amount goes through the same micros rounding as the rollup so the two reconcile exactly. */
export function toWalletTransactionData(row: WalletTxRow, scopeKey: string, ghlAccountId: string | null) {
  return {
    id: row.id,
    scopeKey,
    ghlAccountId,
    settlementTime: parseSettlementTime(row.settlementTime),
    category: parseWalletCategory(row.description),
    description: (row.description ?? "").trim(),
    amount: new Prisma.Decimal(microsToDecimalString(toMicros(row.amount))),
  };
}

export type UsageWindow = { from: string; to: string };

/**
 * Windows the nightly wallet_usage job works through, in order: the previous 2 UTC days, plus — on UTC day-of-month 3
 * only — the whole previous calendar month as ≤7-day windows (keeps each window's cursor and page count bounded).
 */
export function planUsageWindows(now: Date): UsageWindow[] {
  const windows: UsageWindow[] = [previousUtcWindow(now, 2)];
  if (now.getUTCDate() !== 3) return windows;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStart = Date.UTC(y, m - 1, 1); // Date.UTC normalizes m-1 = -1 to December of the previous year
  const nextMonthStart = Date.UTC(y, m, 1);
  for (let start = monthStart; start < nextMonthStart; start += 7 * 864e5) {
    const end = Math.min(start + 7 * 864e5, nextMonthStart) - 1;
    windows.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
  }
  return windows;
}
