import type Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";

// Explicit map, one function, so this is unit-testable without touching the
// DB or Stripe. Confirmed against the pinned SDK's Stripe.Subscription.Status
// union (active | canceled | incomplete | incomplete_expired | past_due |
// paused | trialing | unpaid | OtherString).
//
// `incomplete` maps to null — a NO-OP, not a row write. Embedded checkout
// confirms payment synchronously, so the real active state arrives via a
// created/updated event; never grant entitlement off an unconfirmed sub.
// `OtherString` (an unrecognized future Stripe status) also maps to null for
// the same reason — do not guess an entitlement for a status this map
// doesn't know.
export function mapStripeSubscriptionStatus(
  stripeStatus: Stripe.Subscription.Status,
  eventType: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
): SubscriptionStatus | null {
  // .deleted always lands canceled regardless of the object's own status
  // field — the row is kept (resolver reads active-only), never removed.
  if (eventType === "customer.subscription.deleted") return "canceled";

  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    case "incomplete":
      return null;
    default:
      return null;
  }
}
