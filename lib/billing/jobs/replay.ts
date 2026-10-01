import { processGhlEvent } from "../events/process";
import { sendPendingIntents } from "../intents/send";
import { replayableWhere } from "../processPaymentEvent";
import { retrySideEffects } from "../state/effects";
import type { JobFn } from "./types";

/**
 * Replay GhlEvent rows that failed (any source: payment, stage_change, invoice): unprocessed, attempts < 5, received more than 5 minutes
 * ago. Also retries failed GHL intents (max 5 attempts) and failed live-mode side effects (saas_pause/saas_resume, with
 * backoff, max 5 attempts) — both no-ops unless DUNNING_MODE=live / a decision is actually in mode "live".
 */
export const runReplay: JobFn = async (ctx) => {
  const tried = new Set<string>(Array.isArray(ctx.cursor?.tried) ? (ctx.cursor?.tried as string[]) : []);
  const counts = { considered: 0, processed: 0, failed: 0, other: 0 };

  if (!ctx.apply) {
    const pending = await ctx.db.ghlEvent.count({ where: replayableWhere(ctx.now) });
    return { done: true, summary: { dryRun: true, replayable: pending } };
  }

  for (;;) {
    const batch = await ctx.db.ghlEvent.findMany({
      where: { ...replayableWhere(ctx.now), ...(tried.size ? { id: { notIn: [...tried] } } : {}) },
      orderBy: { receivedAt: "asc" },
      take: 20,
      select: { id: true, source: true },
    });
    if (batch.length === 0) {
      const intents = await sendPendingIntents(ctx.db);
      const effects = await retrySideEffects(ctx.db, { now: () => ctx.now });
      return { done: true, summary: { ...counts, intentsSent: intents.sent, intentsFailed: intents.failed, effectsRetried: effects } };
    }
    for (const e of batch) {
      if (ctx.shouldYield()) return { done: false, cursor: { tried: [...tried] }, summary: counts };
      tried.add(e.id);
      counts.considered++;
      const r = await processGhlEvent(e.id, e.source, ctx.db);
      if (r === "processed") counts.processed++;
      else if (r === "failed") counts.failed++;
      else counts.other++;
    }
  }
};
