import type { PrismaClient } from "@prisma/client";
import { PAYMENT_SOURCE, processPaymentEvent, type ProcessResult as PaymentResult } from "../processPaymentEvent";
import { processInvoiceEvent } from "./invoiceEvent";
import { processStageChanged } from "./stageChanged";
import { OP_INVOICE_SOURCE, processOpInvoiceEvent } from "@/lib/founderOffer/opInvoice";

/** Dispatch a recorded GhlEvent to the processor for its source (used by the replay job so every source is retried the right way).
 *  Only source "payment" is ever processed as a payment. A source with no processor (job_trigger, stage_change_unmapped, client_handoff_review,
 *  anything new) is never a webhook to reprocess — `replayableWhere` already excludes it from the replay job's query, so reaching here at all
 *  would be a bug; this is a defensive no-op that does not touch the row (no attempts, no lastError). */
export async function processGhlEvent(id: string, source: string, db: PrismaClient): Promise<PaymentResult> {
  if (source === "stage_change") return processStageChanged(id, { db });
  if (source === OP_INVOICE_SOURCE) return processOpInvoiceEvent(id, { db });
  if (source === "invoice") return processInvoiceEvent(id, { db });
  if (source === PAYMENT_SOURCE) return processPaymentEvent(id, { db, retryPending: false });
  return "already_processed";
}
