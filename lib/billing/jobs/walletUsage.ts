import { Prisma, type PrismaClient } from "@prisma/client";
import { apiStats, walletTransactionsPage } from "../ghlWallet";
import { accToRows, addToAcc, daysInWindow, microsToDecimalString, planUsageWindows, previousUtcWindow, toWalletTransactionData, unfilteredScope, latestLocationName, type Acc, type RollupRow, type SeenName, type UsageWindow, type WalletTxRow } from "../usageRollup";
import { listWalletLocations, type WalletLocation } from "./locations";
import type { JobContext, JobCursor, JobFn, JobResult } from "./types";

const PAGE = 1000;

type Cursor = {
  window: { from: string; to: string };
  locations: WalletLocation[];
  phase: "locations" | "unfiltered";
  locIdx: number;
  skip: number;
  locAcc: Acc;
  seenIds: string[];
  locName?: SeenName | null; // most recent usable locationName seen for the CURRENT location (reset per location)
  uSkip: number;
  uAcc: Record<string, Acc>; // scopeKey → acc for the unfiltered pass
  stats: { rowsSeen: number; scopesWritten: number; rollupRows: number; unfilteredRows: number; txInserted: number; namesUpdated?: number };
};

export type RollupMismatch = { scopeKey: string; day: string; category: string; rollupCount: number | null; rowsCount: number | null; rollupAmount: string | null; rowsAmount: string | null };

/**
 * Rollup-vs-rows check: for every (scopeKey, day, category) in the window, UsageRollup must equal the sum of
 * WalletTransaction. Returns EVERY disagreement (including a key present on only one side). Insert-or-ignore means an
 * upstream amount correction shows up here — by design.
 */
export async function checkRollupAgainstRows(db: PrismaClient, window: UsageWindow): Promise<RollupMismatch[]> {
  const fromDay = window.from.slice(0, 10);
  const toDay = window.to.slice(0, 10);
  const rows = await db.$queryRaw<
    { scopeKey: string; day: string; category: string; rollupCount: number | null; rowsCount: number | null; rollupAmount: string | null; rowsAmount: string | null }[]
  >`
    SELECT COALESCE(r."scopeKey", w."scopeKey") AS "scopeKey",
           COALESCE(r."day", w."day")::text AS "day",
           COALESCE(r."category", w."category") AS "category",
           r."count"::int AS "rollupCount", w."n"::int AS "rowsCount",
           r."amount"::text AS "rollupAmount", w."s"::text AS "rowsAmount"
    FROM (SELECT "scopeKey", "day", "category", "count", "amount" FROM "UsageRollup"
          WHERE "day" >= ${fromDay}::date AND "day" <= ${toDay}::date) r
    FULL OUTER JOIN (SELECT "scopeKey", "settlementTime"::date AS "day", "category", COUNT(*) AS "n", SUM("amount") AS "s"
                     FROM "WalletTransaction"
                     WHERE "settlementTime" >= ${fromDay}::date AND "settlementTime" < (${toDay}::date + 1)
                     GROUP BY 1, 2, 3) w
      ON r."scopeKey" = w."scopeKey" AND r."day" = w."day" AND r."category" = w."category"
    WHERE r."count" IS DISTINCT FROM w."n" OR r."amount" IS DISTINCT FROM w."s"
    ORDER BY 1, 2, 3`;
  return rows;
}

export type UsageOptions = {
  window?: { from: string; to: string };
  /** Receives each scope's computed rollup rows (used by dry-run reporting). */
  onScope?: (scopeKey: string, rows: RollupRow[]) => void;
};

/** Replace one scope's rollup rows for every day in the window (delete + insert, atomically). */
export async function replaceScope(db: PrismaClient, scopeKey: string, ghlAccountId: string | null, days: string[], rows: RollupRow[]): Promise<void> {
  await db.$transaction([
    db.usageRollup.deleteMany({ where: { scopeKey, day: { in: days.map((d) => new Date(`${d}T00:00:00.000Z`)) } } }),
    db.usageRollup.createMany({
      data: rows.map((r) => ({
        scopeKey,
        ghlAccountId,
        day: new Date(`${r.day}T00:00:00.000Z`),
        category: r.category,
        count: r.count,
        amount: new Prisma.Decimal(microsToDecimalString(r.micros)),
      })),
    }),
  ]);
}

/**
 * Wallet usage rollup over a UTC window. Per-location pass (every member GhlAccount.locationId + HQ once), then an unfiltered
 * pass whose rows no location query returned go to _agency (blank name "-") or _unattributed (named, non-member).
 * Replaces per (scopeKey, day). Resumable via the cursor.
 */
export async function runWalletUsageWindow(ctx: JobContext, opts: UsageOptions = {}): Promise<JobResult> {
  const cur = ctx.cursor as Cursor | null;
  const window = cur?.window ?? opts.window ?? previousUtcWindow(ctx.now, 2);
  const days = daysInWindow(window.from, window.to);
  const st: Cursor =
    cur ?? {
      window,
      locations: await listWalletLocations(ctx.db),
      phase: "locations",
      locIdx: 0,
      skip: 0,
      locAcc: {},
      seenIds: [],
      uSkip: 0,
      uAcc: {},
      stats: { rowsSeen: 0, scopesWritten: 0, rollupRows: 0, unfilteredRows: 0, txInserted: 0, namesUpdated: 0 },
    };
  const seen = new Set(st.seenIds);
  const callsAtStart = apiStats.calls;
  const snapshot = (): Cursor => ({ ...st, seenIds: [...seen] });
  const summary = () => ({ window, ...st.stats, locations: st.locations.length, apiCalls: apiStats.calls - callsAtStart, dryRun: !ctx.apply });

  /** Insert-or-ignore raw rows into WalletTransaction (same pass that builds the rollup). Apply only. */
  const storeRows = async (rows: WalletTxRow[], scopeOf: (r: WalletTxRow) => [string, string | null]) => {
    if (!ctx.apply || rows.length === 0) return;
    const res = await ctx.db.walletTransaction.createMany({
      data: rows.map((r) => {
        const [scopeKey, ghlAccountId] = scopeOf(r);
        return toWalletTransactionData(r, scopeKey, ghlAccountId);
      }),
      skipDuplicates: true,
    });
    st.stats.txInserted += res.count;
  };

  /** No extra API calls: the name comes from rows already fetched for this location. Written only when it differs. Members only (HQ has no account). */
  const recordLocationName = async (loc: WalletLocation) => {
    if (!ctx.apply || !st.locName || !loc.ghlAccountId) return;
    const res = await ctx.db.ghlAccount.updateMany({
      where: { id: loc.ghlAccountId, accountType: "member", OR: [{ locationName: null }, { locationName: { not: st.locName.name } }] },
      data: { locationName: st.locName.name, locationNameUpdatedAt: ctx.now },
    });
    st.stats.namesUpdated = (st.stats.namesUpdated ?? 0) + res.count;
  };

  const sink = async (scopeKey: string, ghlAccountId: string | null, acc: Acc) => {
    const rows = accToRows(acc);
    opts.onScope?.(scopeKey, rows);
    if (ctx.apply) await replaceScope(ctx.db, scopeKey, ghlAccountId, days, rows);
    st.stats.scopesWritten++;
    st.stats.rollupRows += rows.length;
  };

  if (st.phase === "locations") {
    while (st.locIdx < st.locations.length) {
      const loc = st.locations[st.locIdx];
      for (;;) {
        if (ctx.shouldYield()) return { done: false, cursor: snapshot(), summary: summary() };
        const rows = await walletTransactionsPage({ skip: st.skip, from: window.from, to: window.to, locationId: loc.locationId });
        for (const r of rows) {
          seen.add(r.id);
          addToAcc(st.locAcc, r);
        }
        st.locName = latestLocationName(st.locName ?? null, rows);
        await storeRows(rows, () => [loc.locationId, loc.ghlAccountId]);
        st.stats.rowsSeen += rows.length;
        if (rows.length < PAGE) break;
        st.skip += PAGE;
      }
      await sink(loc.locationId, loc.ghlAccountId, st.locAcc);
      await recordLocationName(loc);
      st.locIdx++;
      st.locName = null;
      st.skip = 0;
      st.locAcc = {};
    }
    st.phase = "unfiltered";
  }

  for (;;) {
    if (ctx.shouldYield()) return { done: false, cursor: snapshot(), summary: summary() };
    const rows = await walletTransactionsPage({ skip: st.uSkip, from: window.from, to: window.to });
    const fresh = rows.filter((r) => !seen.has(r.id));
    for (const r of fresh) {
      addToAcc((st.uAcc[unfilteredScope(r.locationName)] ??= {}), r);
      st.stats.unfilteredRows++;
    }
    await storeRows(fresh, (r) => [unfilteredScope(r.locationName), null]);
    if (rows.length < PAGE) break;
    st.uSkip += PAGE;
  }
  // Always replace both agency scopes (even when empty) so stale rows for the window are cleared.
  for (const scope of ["_agency", "_unattributed"]) await sink(scope, null, st.uAcc[scope] ?? {});

  if (!ctx.apply) return { done: true, summary: { ...summary(), rollupCheck: "skipped (dry-run)" } };
  const mismatches = await checkRollupAgainstRows(ctx.db, window);
  return { done: true, summary: { ...summary(), rollupCheck: { mismatchCount: mismatches.length, mismatches } } };
}

type QueueCursor = {
  queue: UsageWindow[];
  idx: number;
  inner: JobCursor | null;
  results: Record<string, unknown>[]; // per-window summaries of finished windows
};

/**
 * Nightly job: previous 2 UTC days, plus the whole previous calendar month (as weekly windows) on UTC day 3.
 * Windows run sequentially; the cursor carries the queue, the position and the in-window cursor, so it resumes anywhere.
 */
export const runWalletUsage: JobFn = async (ctx) => {
  const cur = ctx.cursor as QueueCursor | null;
  const q: QueueCursor = cur && Array.isArray(cur.queue) ? cur : { queue: planUsageWindows(ctx.now), idx: 0, inner: null, results: [] };

  while (q.idx < q.queue.length) {
    const window = q.queue[q.idx];
    const r = await runWalletUsageWindow({ ...ctx, cursor: q.inner }, { window });
    if (!r.done) return { done: false, cursor: { ...q, inner: r.cursor ?? null }, summary: { windows: q.queue.length, windowsDone: q.idx, current: r.summary, results: q.results } };
    q.results.push(r.summary);
    q.idx++;
    q.inner = null;
  }

  const mismatchCount = q.results.reduce((n, r) => n + (typeof r.rollupCheck === "object" && r.rollupCheck ? (r.rollupCheck as { mismatchCount: number }).mismatchCount : 0), 0);
  return { done: true, summary: { windows: q.queue.length, mismatchCount, results: q.results, dryRun: !ctx.apply } };
};
