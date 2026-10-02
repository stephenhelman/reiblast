import type { PrismaClient } from "@prisma/client";
import { fetchTransactionById } from "./ghlTransactions";
import { ingestTransaction, type IngestResult } from "./ingestTransaction";
import { sendPendingIntents } from "./intents/send";
import { shadowDunningForLedger } from "./state/apply";

export const MAX_EVENT_ATTEMPTS = 5;
export const MIN_EVENT_AGE_MS = 5 * 60 * 1000;
const RETRY_AFTER_SUCCESS = 5;

/** Errors no retry can fix; the event is parked at MAX_EVENT_ATTEMPTS so replay doesn't burn calls on it. */
class PermanentEventError extends Error {}

export type ProcessResult = "processed" | "failed" | "already_processed" | "not_found";

export type ProcessOptions = {
  db: PrismaClient;
  /** After a success, retry up to 5 pending failed events (never recurses). Default true. */
  retryPending?: boolean;
};

/** Sources that are never a webhook to replay (nothing "processes" them later): recorded once, done. Currently just the
 *  jobs route's own trigger-attempt log (source "job_trigger", see app/api/webhooks/ghl/jobs/route.ts). */
export const NON_REPLAYABLE_SOURCES = ["job_trigger"] as const;

/** Where an event is eligible for replay: unprocessed, under the attempt cap, old enough, and a source that IS a webhook
 *  (excludes NON_REPLAYABLE_SOURCES even on the rare row where processedAt wasn't set at insert — belt and suspenders). */
export function replayableWhere(now = new Date()) {
  return {
    processedAt: null,
    attempts: { lt: MAX_EVENT_ATTEMPTS },
    receivedAt: { lt: new Date(now.getTime() - MIN_EVENT_AGE_MS) },
    source: { notIn: [...NON_REPLAYABLE_SOURCES] },
  };
}

/**
 * Fetch the full transaction for a recorded GhlEvent, ingest it, mark it processed. Never throws:
 * failures increment attempts and store lastError, leaving processedAt null (contract rules 5 and 6).
 */
export async function processPaymentEvent(eventId: string, opts: ProcessOptions): Promise<ProcessResult> {
  const { db } = opts;
  const event = await db.ghlEvent.findUnique({ where: { id: eventId } });
  if (!event) return "not_found";
  if (event.processedAt) return "already_processed";

  let ingested: IngestResult | null = null;
  try {
    if (!event.externalId) throw new PermanentEventError("no transactionId in body");
    if (!/^[A-Za-z0-9]{10,64}$/.test(event.externalId)) throw new PermanentEventError("invalid transaction id");
    const full = await fetchTransactionById(event.externalId);
    ingested = await ingestTransaction(full, db);
    await db.ghlEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payment-event] processing failed:", message);
    await db.ghlEvent.update({
      where: { id: event.id },
      data: {
        attempts: err instanceof PermanentEventError ? MAX_EVENT_ATTEMPTS : { increment: 1 },
        lastError: message.slice(0, 500),
      },
    });
    return "failed";
  }

  // Shadow dunning (7a): records what the billing state engine WOULD do for this ledger row. Never throws, never changes the
  // outcome above; it runs only after the ledger write and the event are already committed.
  if (ingested && ingested.action === "written") await shadowDunningForLedger(db, ingested.ghlTransactionId);
  // Opportunistic retry of failed/pending GHL intents (max 5 attempts each). Hard no-op unless DUNNING_MODE=live; never throws.
  await sendPendingIntents(db).catch((e) => console.error("[intents] retry failed:", e instanceof Error ? e.message : e));

  if (opts.retryPending !== false) await retryPendingEvents(db, event.id);
  return "processed";
}

/** Retry up to RETRY_AFTER_SUCCESS pending failed events under the replay limits. */
export async function retryPendingEvents(db: PrismaClient, excludeId?: string): Promise<number> {
  const pending = await db.ghlEvent.findMany({
    where: { ...replayableWhere(), source: "payment", ...(excludeId ? { id: { not: excludeId } } : {}) }, // other sources are retried by the replay job's dispatcher
    orderBy: { receivedAt: "asc" },
    take: RETRY_AFTER_SUCCESS,
    select: { id: true },
  });
  for (const p of pending) await processPaymentEvent(p.id, { db, retryPending: false });
  return pending.length;
}
