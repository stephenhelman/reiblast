import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchTransactionById } from "@/lib/billing/ghlTransactions";
import { ingestTransaction } from "@/lib/billing/ingestTransaction";

// GHL → server payment event (docs/ghl-server-contract.md rules 3, 5, 6):
// record the event first, fetch the full transaction by id, ingest idempotently.
// Always returns 200; failures live in GhlEvent.lastError/attempts.

const ok = () => NextResponse.json({ received: true });

// Hash both sides so timingSafeEqual always compares equal-length buffers (length mismatch can't throw or leak).
function secretMatches(incoming: string | null): boolean {
  const expected = process.env.GHL_BILLING_WEBHOOK_SECRET;
  if (!incoming || !expected) return false;
  const a = createHash("sha256").update(incoming).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function extractTransactionId(body: Record<string, unknown>): string | null {
  const custom = body.customData as Record<string, unknown> | undefined;
  const v = body.transactionId ?? body.transaction_id ?? custom?.transaction_id ?? custom?.transactionId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  try {
    if (!secretMatches(req.headers.get("x-reiblast-billing-secret"))) {
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
    const event = await prisma.ghlEvent.create({
      data: { source: "payment", externalId: transactionId, payload: body as Prisma.InputJsonObject },
    });

    try {
      if (!transactionId) throw new Error("no transactionId in body");
      const full = await fetchTransactionById(transactionId);
      await ingestTransaction(full);
      await prisma.ghlEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[payment-event] processing failed:", message);
      await prisma.ghlEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
      });
    }
  } catch (err) {
    console.error("[payment-event] unexpected error:", err instanceof Error ? err.message : err);
  }
  return ok();
}
