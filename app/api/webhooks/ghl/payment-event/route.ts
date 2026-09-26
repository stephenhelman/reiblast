import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getBillingDb } from "@/lib/billing/db";
import { secretMatches } from "@/lib/billing/secret";
import { processPaymentEvent } from "@/lib/billing/processPaymentEvent";

// GHL → server payment event (docs/ghl-server-contract.md rules 3, 5, 6):
// record the event first, fetch the full transaction by id, ingest idempotently.
// Always returns 200; failures live in GhlEvent.lastError/attempts.

const ok = () => NextResponse.json({ received: true });

function extractTransactionId(body: Record<string, unknown>): string | null {
  const custom = body.customData as Record<string, unknown> | undefined;
  const v = body.transactionId ?? body.transaction_id ?? custom?.transaction_id ?? custom?.transactionId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  try {
    if (!secretMatches(req.headers.get("x-reiblast-billing-secret"), "GHL_BILLING_WEBHOOK_SECRET")) {
      console.warn("[payment-event] auth failed — ignoring");
      return ok();
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn("[payment-event] invalid JSON body — ignoring");
      return ok();
    }

    const transactionId = extractTransactionId(body);
    const db = await getBillingDb();
    const event = await db.ghlEvent.create({
      data: { source: "payment", externalId: transactionId, payload: body as Prisma.InputJsonObject },
    });
    await processPaymentEvent(event.id, { db });
  } catch (err) {
    console.error("[payment-event] unexpected error:", err instanceof Error ? err.message : err);
  }
  return ok();
}
