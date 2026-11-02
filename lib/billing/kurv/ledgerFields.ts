import type { NormalizedTransaction } from "../normalizeTransaction";
import { expectedDepositDate, labelDay, windowEndDay, windowStartInstant } from "./batch";

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * The BillingLedgerEntry columns derived from a normalized transaction: gateway facts always, batch facts only for a
 * settled sale (succeeded authCapture with a real chargeId). Shared by ingestTransaction and the backfill so they can't drift.
 */
export function kurvFields(t: NormalizedTransaction) {
  const settledSale =
    t.status === "succeeded" && t.transactionType === "authCaptureTransaction" && !!t.chargeId && t.chargeId !== "0" && t.submitTimeUtc !== null;
  const windowEnd = settledSale ? windowEndDay(t.submitTimeUtc!.toISOString()) : null;
  return {
    chargeId: t.chargeId,
    transactionType: t.transactionType,
    cardBrand: t.cardBrand,
    settleAmountCents: t.settleAmountCents,
    authAmountCents: t.authAmountCents,
    submitTimeUtc: t.submitTimeUtc,
    avsCode: t.avsCode,
    responseCode: t.responseCode,
    isAuthorizeNet: t.isAuthorizeNet,
    batchWindowStart: windowEnd ? windowStartInstant(windowEnd) : null,
    batchDate: windowEnd ? asDate(labelDay(windowEnd)) : null,
    expectedDepositDate: windowEnd ? asDate(expectedDepositDate(windowEnd)) : null,
  };
}
