import type { PrismaClient } from "@prisma/client";
import { processPaymentEvent, type ProcessResult as PaymentResult } from "../processPaymentEvent";
import { processInvoiceEvent } from "./invoiceEvent";
import { processStageChanged } from "./stageChanged";

/** Dispatch a recorded GhlEvent to the processor for its source (used by the replay job so every source is retried the right way). */
export async function processGhlEvent(id: string, source: string, db: PrismaClient): Promise<PaymentResult> {
  if (source === "stage_change") return processStageChanged(id, { db });
  if (source === "invoice") return processInvoiceEvent(id, { db });
  return processPaymentEvent(id, { db, retryPending: false });
}
