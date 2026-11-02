import { batchesDepositedIn, groupBatches, type KurvTx } from "./batch";
import { estimateMonthlyDebit, monthlyActivity, sumBatchFees, type KurvRates } from "./fees";
import { KURV_REFERENCE_STATEMENTS } from "./reference";
import { denverMonthOf } from "../reports/denver";

export type ReconRow = { label: string; predicted: number; actual: number; unit: "count" | "cents"; tolerancePct: number };
export type MonthRecon = { month: string; batches: number; rows: ReconRow[] };

// Known unsettled charge in the Kurv Aug statement (one of two identical $57 rows). Only relevant to Aug.
export const AUG_UNSETTLED_CHARGE_IDS: ReadonlySet<string> = new Set(["121785351029"]);

/** Predicted vs the Kurv statement for a reference month, from gateway rows. Pure. */
export function reconcileMonth(txs: readonly KurvTx[], month: string, rates: KurvRates): MonthRecon {
  const ref = KURV_REFERENCE_STATEMENTS.find((s) => s.month === month);
  if (!ref) throw new Error(`No reference statement for ${month}`);
  const batches = batchesDepositedIn(groupBatches(txs, { excludeChargeIds: AUG_UNSETTLED_CHARGE_IDS }), month);
  const f = sumBatchFees(batches, rates);
  const monthRows = txs.filter((t) => t.submitTimeUtc && denverMonthOf(new Date(t.submitTimeUtc)) === month);
  const debit = estimateMonthlyDebit(monthlyActivity(monthRows, f.grossCents), rates);
  return {
    month,
    batches: batches.length,
    rows: [
      { label: "sales count", predicted: f.items, actual: ref.salesCount, unit: "count", tolerancePct: 0 },
      { label: "sales amount", predicted: f.grossCents, actual: ref.salesAmountCents, unit: "cents", tolerancePct: 0 },
      { label: "daily fees incl. discount", predicted: f.discountCents + f.otherFeesCents, actual: ref.dailyFeesPaidCents, unit: "cents", tolerancePct: 2 },
      { label: "reserve funded", predicted: f.reserveCents, actual: ref.reserveFundedCents, unit: "cents", tolerancePct: 0.2 },
      { label: "monthly debit (estimate)", predicted: debit.totalCents, actual: ref.monthlyDebitCents, unit: "cents", tolerancePct: 2 },
    ],
  };
}
