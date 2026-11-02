import type { WalletBreakdownRow } from "./types";

/** Categories under this total are folded into one "Other" row on the printed statement. */
export const PRINT_OTHER_BELOW_CENTS = 500;

export type PrintWalletRow = { label: string; cents: number };

/** Wallet usage for the printout: scopes merged per category, biggest first, anything under $5 grouped as "Other" (last). */
export function printWalletRows(rows: WalletBreakdownRow[], belowCents = PRINT_OTHER_BELOW_CENTS): PrintWalletRow[] {
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.cents);
  const big: PrintWalletRow[] = [];
  let other = 0;
  let otherCount = 0;
  for (const [category, cents] of byCategory) {
    if (cents < belowCents) { other += cents; otherCount++; } else big.push({ label: category.replace(/_/g, " "), cents });
  }
  big.sort((a, b) => b.cents - a.cents);
  return otherCount ? [...big, { label: "Other", cents: other }] : big;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10" → "October 2026". */
export const monthLabel = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
