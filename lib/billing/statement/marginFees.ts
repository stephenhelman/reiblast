import { monthsBetween } from "../reports/denver";
import type { Money } from "../reports/money";
import { FIRST_STATEMENT_MONTH, kurvFeesCents, type StatementDb } from "./compute";

/** Modeled Kurv fees (daily fees + monthly debit; actual once entered, estimate before) in dollars by Denver month, for the margin view. Replaces the old flat ADMIN_PROCESSOR_FEE_PCT. */
export async function modeledFeesByMonth(db: StatementDb, fromMonth: string, toMonth: string): Promise<Map<string, Money>> {
  const out = new Map<string, Money>();
  for (const m of monthsBetween(fromMonth, toMonth)) {
    if (m < FIRST_STATEMENT_MONTH) continue;
    const cents = await kurvFeesCents(db, m);
    if (cents !== null) out.set(m, (cents / 100).toFixed(6));
  }
  return out;
}
