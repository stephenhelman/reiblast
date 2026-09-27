import type { PrismaClient } from "@prisma/client";
import { NON_REPLAYABLE_SOURCES, processPaymentEvent, type ProcessResult as PaymentResult } from "../processPaymentEvent";
import { processInvoiceEvent } from "./invoiceEvent";
import { processStageChanged } from "./stageChanged";

/** Dispatch a recorded GhlEvent to the processor for its source (used by the replay job so every source is retried the right way).
 *  A NON_REPLAYABLE_SOURCES row (e.g. "job_trigger") is never a webhook to reprocess — `replayableWhere` already excludes it from
 *  the replay job's query, so reaching here at all would be a bug; this is a defensive no-op rather than a payment-parse failure. */
export async function processGhlEvent(id: string, source: string, db: PrismaClient): Promise<PaymentResult> {
  if ((NON_REPLAYABLE_SOURCES as readonly string[]).includes(source)) return "already_processed";
  if (source === "stage_change") return processStageChanged(id, { db });
  if (source === "invoice") return processInvoiceEvent(id, { db });
  return processPaymentEvent(id, { db, retryPending: false });
}
