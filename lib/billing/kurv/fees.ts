import type { Batch, KurvTx } from "./batch";

/** Every rate comes from the dated SettingRate table (seeded in a later checkpoint); nothing here is a default. */
export type KurvRates = {
  /** Discount rate on gross, e.g. 0.029. */
  discountRate: number;
  /** Per non-Amex item, dollars (0.20). */
  perItem: number;
  /** Per batch, dollars (0.35). */
  perBatch: number;
  /** Interchange/downgrade estimate on gross (~0.0044). */
  interchangeRate: number;
  /** Reserve share of gross (0.10). */
  reserveRate: number;
  /** Monthly: per authorization attempt, dollars (0.20). */
  perAuth: number;
  /** Monthly: per AVS check, dollars (0.10). An estimate. */
  perAvs: number;
  /** ESTIMATE: AVS checks billed per authorization (Sep 2026: 280 / 389 ≈ 0.72). Kurv's AVS billing isn't derivable from avsCode. */
  avsPerAuthRatio: number;
  /** Monthly: card-brand fees on volume (~0.006). */
  brandFeeRate: number;
  /** Monthly fixed fees, dollars ($29 access + $5.95 breach + $7 Visa FANF + $1.25 MC location = 43.20). */
  fixedMonthly: number;
};

const c = (dollars: number) => Math.round(dollars * 100);

export type BatchFees = {
  discountCents: number;
  /** Per-item + per-batch + interchange. */
  otherFeesCents: number;
  reserveCents: number;
  /** gross − discount − other fees − reserve */
  depositCents: number;
};

export function batchFees(b: Pick<Batch, "grossCents" | "nonAmexItems">, r: KurvRates): BatchFees {
  const discountCents = Math.round(b.grossCents * r.discountRate);
  const otherFeesCents = c(r.perItem) * b.nonAmexItems + c(r.perBatch) + Math.round(b.grossCents * r.interchangeRate);
  const reserveCents = Math.round(b.grossCents * r.reserveRate);
  return { discountCents, otherFeesCents, reserveCents, depositCents: b.grossCents - discountCents - otherFeesCents - reserveCents };
}

export function sumBatchFees(batches: readonly Batch[], r: KurvRates): BatchFees & { grossCents: number; items: number; batches: number } {
  const acc = { discountCents: 0, otherFeesCents: 0, reserveCents: 0, depositCents: 0, grossCents: 0, items: 0, batches: batches.length };
  for (const b of batches) {
    const f = batchFees(b, r);
    acc.discountCents += f.discountCents;
    acc.otherFeesCents += f.otherFeesCents;
    acc.reserveCents += f.reserveCents;
    acc.depositCents += f.depositCents;
    acc.grossCents += b.grossCents;
    acc.items += b.items;
  }
  return acc;
}

/** Inputs for the monthly debit, counted over a Denver calendar month of submit time (chargeId ≠ "0", snapshot present). */
export type MonthlyActivity = {
  /** authCaptureTransaction attempts, succeeded + declined. */
  captureAttempts: number;
  /** authOnlyTransaction ($1 trial auths); each is billed as two authorizations. */
  authOnlyCount: number;
  /** Settled volume for the statement month, cents. */
  volumeCents: number;
};

export type MonthlyTx = KurvTx;

/** Counts monthly-debit drivers from rows already filtered to the month. */
export function monthlyActivity(txs: readonly MonthlyTx[], volumeCents: number): MonthlyActivity {
  let captureAttempts = 0, authOnlyCount = 0;
  for (const t of txs) {
    if (t.chargeId === "0" || t.transactionType === null) continue;
    if (t.transactionType === "authCaptureTransaction") captureAttempts += 1;
    else if (t.transactionType === "authOnlyTransaction") authOnlyCount += 1;
  }
  return { captureAttempts, authOnlyCount, volumeCents };
}

export type MonthlyDebitEstimate = {
  authorizations: number;
  authFeesCents: number;
  /** ESTIMATE — authorizations × avsPerAuthRatio × perAvs. */
  avsFeesCents: number;
  brandFeesCents: number;
  fixedCents: number;
  totalCents: number;
};

export function estimateMonthlyDebit(a: MonthlyActivity, r: KurvRates): MonthlyDebitEstimate {
  const authorizations = a.captureAttempts + 2 * a.authOnlyCount;
  const authFeesCents = Math.round(authorizations * r.perAuth * 100);
  const avsFeesCents = Math.round(authorizations * r.avsPerAuthRatio * r.perAvs * 100);
  const brandFeesCents = Math.round(a.volumeCents * r.brandFeeRate);
  const fixedCents = c(r.fixedMonthly);
  return { authorizations, authFeesCents, avsFeesCents, brandFeesCents, fixedCents, totalCents: authFeesCents + avsFeesCents + brandFeesCents + fixedCents };
}
