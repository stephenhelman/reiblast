import { denverMonthOf } from "../reports/denver";
import { FIRST_REFRESH_MONTH } from "./walletMonthRefresh";
import { checkRollupAgainstRows } from "./walletUsage";
import type { JobFn } from "./types";

/**
 * wallet_retention — SHIPS DISABLED. Does nothing unless WALLET_RETENTION_ENABLED=true (and nothing is scheduled in GHL
 * until the owner enables it). Deletes raw WalletTransaction rows older than WALLET_RETENTION_DAYS (default 90, floor 60),
 * one UTC day at a time, oldest first, and only when ALL of:
 *   - the statement month(s) the day touches have a COMPLETE wallet_month_refresh (months before the statement start are exempt);
 *   - UsageRollup agrees with the raw rows for that day (checkRollupAgainstRows reports zero mismatches), so the rollup
 *     provably carries the data before the rows go.
 * UsageRollup is never pruned. Deletion is batched; the first disagreement stops the job and is reported in the summary.
 */
export const RETENTION_DEFAULT_DAYS = 90;
export const RETENTION_MIN_DAYS = 60;
const BATCH = 10_000;

export const retentionEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.WALLET_RETENTION_ENABLED === "true";
export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.WALLET_RETENTION_DAYS);
  return Number.isFinite(n) && n >= RETENTION_MIN_DAYS ? Math.floor(n) : RETENTION_DEFAULT_DAYS;
}

export const runWalletRetention: JobFn = async (ctx) => {
  if (!retentionEnabled()) return { done: true, summary: { disabled: true, note: "set WALLET_RETENTION_ENABLED=true to enable" } };
  const days = retentionDays();
  const cutoff = new Date(ctx.now.getTime() - days * 864e5);
  const complete = new Set((await ctx.db.walletMonthRefresh.findMany({ where: { completedAt: { not: null } }, select: { month: true } })).map((r) => r.month));
  let deleted = 0, daysCleared = 0;

  for (;;) {
    if (ctx.shouldYield()) return { done: false, cursor: {}, summary: { days, cutoff: cutoff.toISOString(), deleted, daysCleared } };
    const oldest = await ctx.db.walletTransaction.findFirst({ where: { settlementTime: { lt: cutoff } }, orderBy: { settlementTime: "asc" }, select: { settlementTime: true } });
    if (!oldest) break;
    const dayStart = new Date(Date.UTC(oldest.settlementTime.getUTCFullYear(), oldest.settlementTime.getUTCMonth(), oldest.settlementTime.getUTCDate()));
    const dayEnd = new Date(Math.min(dayStart.getTime() + 864e5, cutoff.getTime()));
    const dayLabel = dayStart.toISOString().slice(0, 10);

    const months = new Set([denverMonthOf(dayStart), denverMonthOf(new Date(dayStart.getTime() + 864e5 - 1))]);
    const blocking = [...months].filter((m) => m >= FIRST_REFRESH_MONTH && !complete.has(m));
    if (blocking.length) return { done: true, summary: { days, deleted, daysCleared, stoppedAt: dayLabel, reason: `wallet_month_refresh not complete for ${blocking.join(", ")}` } };

    const window = { from: dayStart.toISOString(), to: new Date(dayStart.getTime() + 864e5 - 1).toISOString() };
    const mismatches = await checkRollupAgainstRows(ctx.db, window);
    if (mismatches.length) return { done: true, summary: { days, deleted, daysCleared, stoppedAt: dayLabel, reason: "UsageRollup disagrees with raw rows", mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 20) } };

    if (!ctx.apply) {
      const n = await ctx.db.walletTransaction.count({ where: { settlementTime: { gte: dayStart, lt: dayEnd } } });
      return { done: true, summary: { dryRun: true, days, wouldDeleteFirstDay: { day: dayLabel, rows: n }, note: "dry-run deletes nothing and stops after the first eligible day" } };
    }
    for (;;) {
      const n = await ctx.db.$executeRaw`DELETE FROM "WalletTransaction" WHERE "id" IN (SELECT "id" FROM "WalletTransaction" WHERE "settlementTime" >= ${dayStart} AND "settlementTime" < ${dayEnd} LIMIT ${BATCH})`;
      deleted += n;
      if (n < BATCH) break;
      if (ctx.shouldYield()) return { done: false, cursor: {}, summary: { days, deleted, daysCleared } };
    }
    daysCleared++;
  }
  return { done: true, summary: { days, cutoff: cutoff.toISOString(), deleted, daysCleared } };
};

