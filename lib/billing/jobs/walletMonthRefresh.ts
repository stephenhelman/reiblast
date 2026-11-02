import { STATEMENT_START } from "../kurv/reference";
import { addMonths, currentDenverMonth } from "../reports/denver";
import type { UsageWindow } from "../usageRollup";
import { runWalletUsageWindow } from "./walletUsage";
import type { JobFn } from "./types";

/**
 * wallet_month_refresh: re-pulls every agency wallet transaction of a finished Denver month, in small windows, so the
 * statement's wallet line (and the retention job) can rely on a COMPLETE month. Resumable across scheduled runs:
 *  - progress (windowsDone) lives in WalletMonthRefresh, so a run that hits the continuation cap, crashes or is simply
 *    out of budget picks up at the next window on the next trigger;
 *  - inside a run, the runner's cursor carries the position within a window;
 *  - once every month up to last month is complete, a run does nothing (cheap no-op) — safe to schedule often.
 */
export const REFRESH_WINDOW_DAYS = 3;
export const FIRST_REFRESH_MONTH = STATEMENT_START.slice(0, 7);
const DAY = 864e5;

/** UTC windows covering a Denver month: UTC day 1 of the month through UTC day 1 of the next (Denver midnight is 06:00–07:00Z), in 3-day chunks. */
export function refreshWindows(month: string): UsageWindow[] {
  const [y, m] = month.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const endExclusive = Date.UTC(y, m, 2); // through the whole UTC day of the 1st of the next month
  const out: UsageWindow[] = [];
  for (let s = start; s < endExclusive; s += REFRESH_WINDOW_DAYS * DAY) out.push({ from: new Date(s).toISOString(), to: new Date(Math.min(s + REFRESH_WINDOW_DAYS * DAY, endExclusive) - 1).toISOString() });
  return out;
}

/** A month can be refreshed once its last Denver instant AND the whole UTC day after are in the past (UTC day 2 of the next month). */
export const refreshEligibleAt = (month: string): Date => new Date(`${addMonths(month, 1)}-02T00:00:00.000Z`);

/** Months from the statement start through last month, in order, that are eligible now and not yet complete. */
export function monthsToRefresh(now: Date, completed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const last = addMonths(currentDenverMonth(now), -1);
  for (let m = FIRST_REFRESH_MONTH; m <= last; m = addMonths(m, 1)) if (now >= refreshEligibleAt(m) && !completed.has(m)) out.push(m);
  return out;
}

type Cursor = { month: string; idx: number; inner: Record<string, unknown> | null; mismatches: number };

export const runWalletMonthRefresh: JobFn = async (ctx) => {
  const done = new Set((await ctx.db.walletMonthRefresh.findMany({ where: { completedAt: { not: null } }, select: { month: true } })).map((r) => r.month));
  const cur = ctx.cursor as Cursor | null;
  const month = cur?.month ?? monthsToRefresh(ctx.now, done)[0];
  if (!month) return { done: true, summary: { noop: true, reason: "no finished month is waiting for a wallet refresh", completedMonths: [...done].sort() } };

  const windows = refreshWindows(month);
  const row = ctx.apply
    ? await ctx.db.walletMonthRefresh.upsert({ where: { month }, create: { month, windowsTotal: windows.length }, update: { windowsTotal: windows.length } })
    : await ctx.db.walletMonthRefresh.findUnique({ where: { month } });
  let idx = cur?.idx ?? row?.windowsDone ?? 0;
  let inner = cur?.inner ?? null;
  let mismatches = cur?.mismatches ?? 0;

  while (idx < windows.length) {
    const r = await runWalletUsageWindow({ ...ctx, cursor: inner }, { window: windows[idx] });
    if (!r.done) return { done: false, cursor: { month, idx, inner: r.cursor ?? null, mismatches }, summary: { month, windows: windows.length, windowsDone: idx, current: r.summary } };
    const check = (r.summary as { rollupCheck?: { mismatchCount?: number } }).rollupCheck;
    const found = typeof check === "object" && check ? (check.mismatchCount ?? 0) : 0;
    mismatches += found;
    idx++;
    inner = null;
    if (ctx.apply) await ctx.db.walletMonthRefresh.update({ where: { month }, data: { windowsDone: idx, mismatchCount: { increment: found } } });
  }

  if (ctx.apply) await ctx.db.walletMonthRefresh.update({ where: { month }, data: { windowsDone: windows.length, completedAt: ctx.now } });
  return { done: true, summary: { month, windows: windows.length, mismatchCount: mismatches, completed: ctx.apply, dryRun: !ctx.apply } };
};
