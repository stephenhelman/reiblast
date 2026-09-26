import type { BillingClass } from "@prisma/client";
import type { NormalizedTransaction } from "./normalizeTransaction";

export const CLASSIFIER_VERSION = 1;

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

  if (t.entitySourceType === "payment_link" && !t.subscriptionId && t.status === "failed") {
    return { classification: "failed_signup", reason: "failed payment_link without subscription" };
  }

  return { classification: "unclassified", reason: "no rule matched" };
}
