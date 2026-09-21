import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { fund } from "@/lib/engine/funding";
import { landSubscriptionItem, cancelOrphanSubscriptions } from "@/lib/engine/subscriptionLand";
import { mapStripeSubscriptionStatus } from "@/lib/webhooks/subscriptionStatus";

type TxClient = Prisma.TransactionClient;

// Pack purchase → funding (LOCKED #2). Only fires for mode:'payment'
// sessions — mode:'subscription' sessions are routed away by the caller
// before this is reached, per LOCKED #1 (customer.subscription.* owns land +
// lifecycle for subscriptions).
export async function handlePackPurchase(tx: TxClient, session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error(`[stripe webhook] checkout.session.completed ${session.id} (mode=payment) has no metadata.userId`);
    return;
  }

  const creditPackIds = (session.metadata?.creditPackIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (creditPackIds.length === 0) {
    // Upstream anomaly (mintCheckout always stamps creditPackIds for a
    // payment-mode cart) — log loudly, don't crash the handler/retry loop
    // over a session we can't act on.
    console.error(
      `[stripe webhook] checkout.session.completed ${session.id} (mode=payment) has no metadata.creditPackIds`,
    );
    return;
  }

  for (const creditPackId of creditPackIds) {
    const pack = await tx.creditPack.findUnique({ where: { id: creditPackId } });
    if (!pack) {
      // Kept inside the loop/transaction deliberately: an unresolvable pack
      // id is as much an anomaly as missing metadata, and throwing here rolls
      // back the marker + every prior fund in this event for a clean retry,
      // per LOCKED #4/#Step 4 (mid-loop failure => full reprocess).
      throw new Error(`[stripe webhook] checkout.session.completed ${session.id}: CreditPack ${creditPackId} not found`);
    }

    // credits comes from the CreditPack row, never trusted off Stripe.
    await fund(tx, userId, pack.credits, "pack_purchase", { creditPackId: pack.id, refId: session.id });
  }
}

export type SubscriptionEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

interface ResolvedItem {
  tierId: string;
  featureId: string;
}

// Reverse-lookup a subscription item's Price ID → its Tier, via the @unique
// stripePriceId seam (same seam mintCheckout's resolvePrice uses forward).
// An in-bundle line's Price lives on a BundlePriceOverride row, not the
// Tier's own stripePriceId — check both; either way the item lands as a
// tool_sub against the underlying Tier (bundle membership is DERIVED, see
// lib/bundleQualify.ts, never stored on the Subscription row itself). Takes
// tx; never opens its own $transaction (Step 4 lesson — every engine/lookup
// helper the webhook calls must be transaction-composable).
async function resolveSubscriptionItemPrice(tx: TxClient, priceId: string): Promise<ResolvedItem> {
  const [tier, override] = await Promise.all([
    tx.tier.findUnique({ where: { stripePriceId: priceId } }),
    tx.bundlePriceOverride.findUnique({ where: { stripePriceId: priceId } }),
  ]);

  if (tier) return { tierId: tier.id, featureId: tier.featureId };
  if (override) {
    const overrideTier = await tx.tier.findUniqueOrThrow({
      where: { featureId_level: { featureId: override.featureId, level: override.level } },
    });
    return { tierId: overrideTier.id, featureId: overrideTier.featureId };
  }

  throw new Error(`[stripe webhook] subscription item priceId "${priceId}" does not resolve to any Tier or BundlePriceOverride row`);
}

interface PreparedItem {
  tierId: string;
  featureId: string;
  periodStart: Date;
  periodEnd: Date;
}

// Subscription purchase → entitlement (LOCKED #1/#5/#6). One Subscription
// row per subscription ITEM, upserted on (stripeSubscriptionId, tierId) — a
// bundle member is N tool_sub rows (one per tool), never a stored bundle
// row; the store cart can also add multiple solo tool-subs before checkout,
// so either way one Stripe subscription can carry multiple recurring items
// spanning multiple features (see the per-item-uniqueness migration). NEVER
// calls fund() — allowance is derived from the period window; only pack
// purchases fund the wallet.
export async function handleSubscriptionEvent(
  tx: TxClient,
  subscription: Stripe.Subscription,
  eventType: SubscriptionEventType,
): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error(`[stripe webhook] ${eventType} ${subscription.id} has no metadata.userId`);
    return;
  }

  const status = mapStripeSubscriptionStatus(subscription.status, eventType);
  if (status === null) {
    // Bare `incomplete` (or an unrecognized future status) — no-op, do not
    // land a row / grant entitlement on an unconfirmed subscription.
    return;
  }

  const items = subscription.items.data;
  if (items.length === 0) {
    // Structurally unexpected (a subscription always has >=1 item, even on
    // .deleted) — throw so this event retries visibly rather than silently
    // landing nothing.
    throw new Error(`[stripe webhook] ${eventType} ${subscription.id} has no items`);
  }

  // Pass 1: resolve every item's Price → tier BEFORE any write. This is
  // required, not just tidy — the cancel-orphans step below must run before
  // any upsert, and it needs the full current tier set to know what's
  // orphaned (see the CRITICAL ORDERING INVARIANT: a same-feature tier
  // change, e.g. score plus→pro inside Bundle Plus, is an INSERT of a new
  // (stripeSubscriptionId, tierId) row while the old tierId row is still
  // active — if that insert runs before the old row is canceled, both rows
  // are simultaneously active for (userId, featureId), tripping the partial
  // unique index. Resolving first costs nothing extra: these are pure reads.
  const prepared: PreparedItem[] = [];
  for (const item of items) {
    const resolved = await resolveSubscriptionItemPrice(tx, item.price.id);
    // current_period_start/end live on the ITEM under this SDK/API version
    // (2026-08-26.dahlia removed them from the top-level Subscription
    // object) — confirmed against node_modules/stripe's SubscriptionItem type.
    prepared.push({
      tierId: resolved.tierId,
      featureId: resolved.featureId,
      periodStart: new Date(item.current_period_start * 1000),
      periodEnd: new Date(item.current_period_end * 1000),
    });
  }

  const currentTierIds = prepared.map((p) => p.tierId);

  // Pass 2: cancel orphans BEFORE upserting current items — mandatory
  // ordering (see above). An item dropped from the subscription (e.g. a
  // Pro -> Plus downgrade removing the close/base line) never reappears in
  // `items` again, so upserting first would leave its row silently active
  // forever; upserting after frees the (userId, featureId) slot before any
  // same-feature tier change tries to claim it. Rows are kept (never
  // deleted), same as the .deleted branch. Scoped by stripeSubscriptionId —
  // the shared helper (lib/engine/subscriptionLand.ts) the comp caller also
  // uses, scoped there by {userId, featureId} instead (no stripeSubscriptionId
  // on a comped sub).
  await cancelOrphanSubscriptions(tx, { stripeSubscriptionId: subscription.id, excludeTierIds: currentTierIds });

  // Pass 3: land current items via the extracted core (status-agnostic
  // locate + resurrect-or-create — see lib/engine/subscriptionLand.ts for the
  // full rationale). Safe to call per-item directly rather than
  // tx.subscription.upsert(): no Prisma-recognized compound unique target
  // exists for the partial index, and there's no cross-request race here
  // since the whole handler already runs inside the outer per-event
  // transaction (the ProcessedStripeEvent marker).
  for (const item of prepared) {
    await landSubscriptionItem(tx, {
      userId,
      tierId: item.tierId,
      featureId: item.featureId,
      status,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      stripeSubscriptionId: subscription.id,
    });
  }
}

// Runs INSIDE the same transaction as the ProcessedStripeEvent marker insert
// (see route.ts POST) — a throw here rolls the marker back too, so a failed
// effect is retried by Stripe rather than silently marked done.
export async function handleEvent(tx: TxClient, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "payment") {
        await handlePackPurchase(tx, session);
      }
      // mode === 'subscription' → no-op; customer.subscription.* owns it.
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionEvent(tx, subscription, event.type);
      return;
    }
    default:
      return;
  }
}
