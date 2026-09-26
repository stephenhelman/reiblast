import { processPaymentEvent, replayableWhere } from "../processPaymentEvent";
import type { JobFn } from "./types";

/** Replay GhlEvent rows that failed: unprocessed, attempts < 5, received more than 5 minutes ago. */
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
      select: { id: true },
    });
    if (batch.length === 0) return { done: true, summary: counts };
    for (const e of batch) {
      if (ctx.shouldYield()) return { done: false, cursor: { tried: [...tried] }, summary: counts };
      tried.add(e.id);
      counts.considered++;
      const r = await processPaymentEvent(e.id, { db: ctx.db, retryPending: false });
      if (r === "processed") counts.processed++;
      else if (r === "failed") counts.failed++;
      else counts.other++;
    }
  }
};
