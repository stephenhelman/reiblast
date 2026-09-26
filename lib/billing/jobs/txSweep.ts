import { classify, CLASSIFIER_VERSION } from "../classify";
import { listTransactionsPage } from "../ghlTransactions";
import { ingestTransaction } from "../ingestTransaction";
import { normalizeTransaction } from "../normalizeTransaction";
import type { JobFn } from "./types";

const WINDOW_DAYS = 35;
const PAGE = 100;

/** Rolling 35-day sweep of the payments list through ingestTransaction (catches events the webhook missed). */
export const runTxSweep: JobFn = async (ctx) => {
  const c = ctx.cursor as { offset?: number; startAt?: string; endAt?: string; acc?: Record<string, number> } | null;
  const startAt = c?.startAt ?? new Date(ctx.now.getTime() - WINDOW_DAYS * 864e5).toISOString();
  const endAt = c?.endAt ?? ctx.now.toISOString();
  const acc: Record<string, number> = c?.acc ?? {};
  const bump = (k: string, n = 1) => (acc[k] = (acc[k] ?? 0) + n);
  let offset = c?.offset ?? 0;
  const state = () => ({ offset, startAt, endAt, acc });

  for (;;) {
    if (ctx.shouldYield()) return { done: false, cursor: state(), summary: { ...acc, offset } };
    const { data, totalCount } = await listTransactionsPage({ offset, limit: PAGE, startAt, endAt });
    bump("fetched", data.length);

    let existing = new Set<string>();
    if (!ctx.apply) {
      const ids = data.map((r) => (r as { _id?: string })._id).filter((x): x is string => !!x);
      existing = new Set((await ctx.db.billingLedgerEntry.findMany({ where: { ghlTransactionId: { in: ids } }, select: { ghlTransactionId: true } })).map((r) => r.ghlTransactionId));
    }

    for (let i = 0; i < data.length; i++) {
      // Each record is sequential DB round-trips, so a 100-record page can take ~17s: hand off mid-page too.
      if (i > 0 && ctx.shouldYield()) {
        offset += i;
        return { done: false, cursor: state(), summary: { ...acc, offset } };
      }
      const rec = data[i];
      try {
        if (ctx.apply) {
          const r = await ingestTransaction(rec, ctx.db);
          bump(r.action === "ignored" ? "ignored" : `written:${r.classification}`);
        } else {
          const n = normalizeTransaction(rec);
          const cl = classify(n);
          if (cl.classification === "ignore") bump("ignored");
          else bump(`${existing.has(n.id) ? "would_update" : "would_create"}:${cl.classification}`);
        }
      } catch (err) {
        bump("errors");
        console.error("[tx_sweep] record failed:", err instanceof Error ? err.message : err);
      }
    }
    offset += data.length;
    if (data.length === 0 || data.length < PAGE || (totalCount !== null && offset >= totalCount)) {
      return { done: true, summary: { ...acc, window: { startAt, endAt }, classifierVersion: CLASSIFIER_VERSION, dryRun: !ctx.apply } };
    }
  }
};
