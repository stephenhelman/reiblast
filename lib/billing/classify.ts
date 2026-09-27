import type { BillingClass } from "@prisma/client";
import type { NormalizedTransaction } from "./normalizeTransaction";

/**
 * v2: rule 5 also catches failed rows with no subtype at all (e.g. failed form/order signups), not just payment_link sources.
 * Rows classified by an earlier version keep their stored classifierVersion until scripts/billing/reclassify-ledger.ts changes them.
 */
export const CLASSIFIER_VERSION = 2;

export type Classification = { classification: BillingClass | "ignore"; reason: string };

const AUTO_RECHARGE = /^\s*auto-?recharge/i;
// Subscription-path sources: a failed renewal can arrive without a subscriptionId, so the source subtype counts too.
const SUBSCRIPTION_SUBTYPES = ["saas_subscription", "subscription_view"];

/**
 * Pure. Describes WHAT the payment was, not its outcome — refunds/failures are carried by
 * status + amountRefunded, so the `refund` enum value is deliberately unused in v1.
 * Rule order matters: $0 (3) must precede subscription (4) because $0 trial rows carry a subscriptionId.
 */
export function classify(t: NormalizedTransaction): Classification {
  if (t.liveMode === false) return { classification: "ignore", reason: "test-mode transaction (liveMode=false)" };

  if (t.entitySourceSubType === "saas_one_time") {
    return AUTO_RECHARGE.test(t.description ?? "")
      ? { classification: "wallet_auto_recharge", reason: "saas_one_time with auto-recharge description" }
      : { classification: "wallet_manual_recharge", reason: "saas_one_time without auto-recharge description" };
  }

  if (t.amount === 0) return { classification: "trial_auth", reason: "amount is 0" };

  if (t.subscriptionId || t.entityType === "invoice" || SUBSCRIPTION_SUBTYPES.includes(t.entitySourceSubType ?? "")) {
    return {
      classification: "core_subscription",
      reason: t.subscriptionId ? "has subscriptionId" : t.entityType === "invoice" ? "entityType invoice" : "subscription source subtype",
    };
  }

  // Rule 5 (v2): a failed payment with no subscription that came from a payment_link OR has no source subtype at all.
  // Rules 2-4 have already claimed wallet recharges, $0 rows and anything subscription-shaped (incl. saas_subscription).
  if (t.status === "failed" && !t.subscriptionId && (t.entitySourceType === "payment_link" || !t.entitySourceSubType)) {
    return {
      classification: "failed_signup",
      reason: t.entitySourceType === "payment_link" ? "failed payment_link without subscription" : "failed payment with no source subtype and no subscription",
    };
  }

  return { classification: "unclassified", reason: "no rule matched" };
}
