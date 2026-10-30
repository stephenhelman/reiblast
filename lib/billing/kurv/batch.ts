import { denverDayOf, denverWallInstant } from "../reports/denver";
import { addDays, dayOfWeek, nextBankDay } from "./calendar";

/**
 * Kurv batch = the window from 5:00 PM America/Denver the previous day to 5:00 PM on the window's end date,
 * bucketed by chargeSnapshot.submitTimeUTC. The window is identified by its END day (`windowEnd`): one window per
 * calendar day. Saturday's window keeps its own identity but Kurv labels it Sunday (`batchDate`), so two windows can
 * share a label — count batches by `windowEnd`, never by `batchDate`.
 */
export type KurvTx = {
  chargeId: string;
  /** "succeeded" | "failed" | … as stored by GHL. */
  status: string;
  /** Authorize.net chargeSnapshot.transactionType, or null when no snapshot is present. */
  transactionType: string | null;
  submitTimeUtc: string | null;
  /** Dollars settled (chargeSnapshot.settleAmount). Never the fractional GHL `amount`. */
  settleAmount: number | null;
  cardBrand: string | null;
};

export const BATCH_CUTOFF_HOUR = 17;
export const isAmexBrand = (brand: string | null) => !!brand && /^american\s*express$|^amex$/i.test(brand.replace(/\s/g, ""));

/** Succeeded authCaptureTransaction, real chargeId (not "0"), snapshot present. ID length is deliberately not a rule. */
export function isSettledSale(t: KurvTx): boolean {
  return (
    t.status === "succeeded" &&
    t.transactionType === "authCaptureTransaction" &&
    t.chargeId !== "0" &&
    t.chargeId !== "" &&
    t.submitTimeUtc !== null &&
    t.settleAmount !== null
  );
}

/** Denver calendar day on which the window containing this instant ends (after 5 PM → next day). */
export function windowEndDay(submitUtc: string): string {
  const instant = new Date(submitUtc);
  const day = denverDayOf(instant);
  return instant >= denverWallInstant(day, BATCH_CUTOFF_HOUR) ? addDays(day, 1) : day;
}

/** UTC instant the window ending on `windowEnd` opened (5 PM Denver the previous day). */
export function windowStartInstant(windowEnd: string): Date {
  return denverWallInstant(addDays(windowEnd, -1), BATCH_CUTOFF_HOUR);
}

/** Kurv's label for a window: Saturday windows are labeled Sunday. */
export const labelDay = (windowEnd: string): string => (dayOfWeek(windowEnd) === 6 ? addDays(windowEnd, 1) : windowEnd);

/** Matches the legacy scripts/billing-audit batchDate(): the labeled batch date for an instant. */
export const batchDateOf = (submitUtc: string): string => labelDay(windowEndDay(submitUtc));

/** Next bank day after the window closes. A Saturday window closes Saturday, so it deposits the next bank day (Monday). */
export const expectedDepositDate = (windowEnd: string): string => nextBankDay(windowEnd);

export type Batch = {
  windowEnd: string;
  windowStart: Date;
  /** Kurv label (Saturday → Sunday). */
  batchDate: string;
  depositDate: string;
  items: number;
  nonAmexItems: number;
  grossCents: number;
};

export const toCents = (dollars: number): number => Math.round(dollars * 100);

/** Groups settled sales into batches by window, ascending. Non-settled rows are ignored. */
export function groupBatches(txs: readonly KurvTx[], opts: { excludeChargeIds?: ReadonlySet<string> } = {}): Batch[] {
  const by = new Map<string, Batch>();
  for (const t of txs) {
    if (!isSettledSale(t) || opts.excludeChargeIds?.has(t.chargeId)) continue;
    const end = windowEndDay(t.submitTimeUtc!);
    let b = by.get(end);
    if (!b) {
      b = { windowEnd: end, windowStart: windowStartInstant(end), batchDate: labelDay(end), depositDate: expectedDepositDate(end), items: 0, nonAmexItems: 0, grossCents: 0 };
      by.set(end, b);
    }
    b.items += 1;
    if (!isAmexBrand(t.cardBrand)) b.nonAmexItems += 1;
    b.grossCents += toCents(t.settleAmount!);
  }
  return [...by.values()].sort((a, b) => (a.windowEnd < b.windowEnd ? -1 : 1));
}

/** Batches whose deposit date falls in the statement month ("YYYY-MM"). */
export const batchesDepositedIn = (batches: readonly Batch[], month: string): Batch[] => batches.filter((b) => b.depositDate.startsWith(month));
