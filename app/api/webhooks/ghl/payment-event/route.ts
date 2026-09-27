import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getBillingDb } from "@/lib/billing/db";
import { checkSecret, type Reason } from "@/lib/billing/reason";
import { processPaymentEvent } from "@/lib/billing/processPaymentEvent";

// GHL → server payment event (docs/ghl-server-contract.md rules 3, 5, 6):
// record the event first, fetch the full transaction by id, ingest idempotently.
// Always returns 200; failures live in GhlEvent.lastError/attempts. `reason` uses the shared vocabulary
// (lib/billing/reason.ts) — never a secret value, stack trace, or expected value.

const reply = (reason: Reason) => NextResponse.json({ received: reason === "accepted", reason });

function extractTransactionId(body: Record<string, unknown>): string | null {
  const custom = body.customData as Record<string, unknown> | undefined;
  const v = body.transactionId ?? body.transaction_id ?? custom?.transaction_id ?? custom?.transactionId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = checkSecret(req.headers.get("x-reiblast-billing-secret"), "GHL_BILLING_WEBHOOK_SECRET");
    if (auth === "misconfigured") {
      console.error("[payment-event] GHL_BILLING_WEBHOOK_SECRET is not set — refusing");
      return reply("server_misconfigured");
    }
    if (auth === "missing") {
      console.warn("[payment-event] auth missing — ignoring");
      return reply("auth_missing");
    }
    if (auth === "failed") {
      console.warn("[payment-event] auth failed — ignoring");
      return reply("auth_failed");
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn("[payment-event] invalid JSON body — ignoring");
      return reply("bad_json");
    }

    const transactionId = extractTransactionId(body);
    const db = await getBillingDb();
    const event = await db.ghlEvent.create({
      data: { source: "payment", externalId: transactionId, payload: body as Prisma.InputJsonObject },
    });
    await processPaymentEvent(event.id, { db });
    return reply("accepted");
  } catch (err) {
    console.error("[payment-event] unexpected error:", err instanceof Error ? err.message : err);
    return reply("server_misconfigured");
  }
}
