import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { fund } from "@/lib/engine/funding";
import { mapStripeSubscriptionStatus } from "@/lib/webhooks/subscriptionStatus";

type TxClient = Prisma.TransactionClient;

// Events this receiver acts on (LOCKED decisions — see REItools-Architecture.md
// Chat B appendix): pack purchases land on the one-time checkout session;
// subscription land + lifecycle live entirely on the subscription object
// itself, never on checkout.session.completed for subscriptions.
const HANDLED_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

// Pack purchase → funding (LOCKED #2). Only fires for mode:'payment'
// sessions — mode:'subscription' sessions are routed away by the caller
// before this is reached, per LOCKED #1 (customer.subscription.* owns land +
// lifecycle for subscriptions).
async function handlePackPurchase(tx: TxClient, session: Stripe.Checkout.Session): Promise<void> {
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

  const processedTierIds: string[] = [];

  for (const item of items) {
    const priceId = item.price.id;
    const resolved = await resolveSubscriptionItemPrice(tx, priceId);
    processedTierIds.push(resolved.tierId);

    // current_period_start/end live on the ITEM under this SDK/API version
    // (2026-08-26.dahlia removed them from the top-level Subscription
    // object) — confirmed against node_modules/stripe's SubscriptionItem type.
    const periodStart = new Date(item.current_period_start * 1000);
    const periodEnd = new Date(item.current_period_end * 1000);

    const data = {
      userId,
      tierId: resolved.tierId,
      featureId: resolved.featureId,
      status,
      periodStart,
      periodEnd,
      stripeSubscriptionId: subscription.id,
    };

    // No Prisma-recognized compound unique target exists for a partial
    // index, so the upsert is find-then-write rather than tx.subscription.
    // upsert() — safe here because this whole handler already runs inside
    // the outer per-event transaction (the ProcessedStripeEvent marker),
    // so there's no cross-request race on this find+write pair.
    const existing = await tx.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id, tierId: resolved.tierId },
    });

    if (existing) {
      await tx.subscription.update({ where: { id: existing.id }, data });
    } else {
      await tx.subscription.create({ data });
    }
  }

  // Downgrade/line-removal reconciliation: an item dropped from the
  // subscription (e.g. a Pro -> Plus downgrade removing the close/base line)
  // never reappears in `items` again, so the loop above would otherwise
  // leave its row silently active forever — an orphaned entitlement. Cancel
  // every row for this stripeSubscriptionId that the current item set didn't
  // just touch. Rows are kept (never deleted), same as the .deleted branch.
  await tx.subscription.updateMany({
    where: {
      stripeSubscriptionId: subscription.id,
      tierId: { notIn: processedTierIds },
      status: { not: "canceled" },
    },
    data: { status: "canceled" },
  });
}

// Runs INSIDE the same transaction as the ProcessedStripeEvent marker insert
// (see POST below) — a throw here rolls the marker back too, so a failed
// effect is retried by Stripe rather than silently marked done.
async function handleEvent(tx: TxClient, event: Stripe.Event): Promise<void> {
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

export async function POST(req: NextRequest) {
  // Signature verification needs the exact raw bytes Stripe signed — req.json()
  // would re-serialize and break the signature, so read text() only.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown signature verification error";
    return NextResponse.json({ error: `Signature verification failed: ${message}` }, { status: 400 });
  }

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  // Marker insert + effect in ONE transaction (LOCKED #4) — never "mark
  // first, then process" as two steps, or a mid-handler failure drops the
  // event with no retry (the marker would already say done).
  try {
    // Explicit timeout: a multi-item subscription (N tool_sub upserts + the
    // downgrade-reconciliation query) can exceed Prisma's 5s interactive-
    // transaction default under real network latency, which would abort the
    // transaction mid-handler — not a business failure, just not enough
    // clock. 20s covers a realistic worst-case item count with margin.
    await prisma.$transaction(
      async (tx) => {
        await tx.processedStripeEvent.create({ data: { id: event.id } });
        await handleEvent(tx, event);
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    // The marker's own P2002 (already processed) is the ONLY case that
    // short-circuits to 200 with no retry. Anything else — including a
    // P2002 from Subscription_active_tool_sub_per_user_feature, which is the
    // replace-not-stack rejection / self-heal case, not "already handled" —
    // rolls the marker back with the rest of the tx and must 500 so Stripe
    // retries. Discriminate on meta.modelName, not just the P2002 code,
    // since both markers and the Subscription partial index throw P2002.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      err.meta?.modelName === "ProcessedStripeEvent"
    ) {
      return NextResponse.json({ received: true, alreadyProcessed: true });
    }

    console.error(`[stripe webhook] handler failed for event ${event.id} (${event.type})`, err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
