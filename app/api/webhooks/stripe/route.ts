import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { handleEvent } from "@/lib/stripe/webhookHandlers";

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
