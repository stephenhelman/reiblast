import { Prisma, type PrismaClient } from "@prisma/client";
import { apiStats, walletTransactionsPage } from "../ghlWallet";
import { accToRows, addToAcc, daysInWindow, microsToDecimalString, previousUtcWindow, unfilteredScope, type Acc, type RollupRow } from "../usageRollup";
import { listWalletLocations, type WalletLocation } from "./locations";
import type { JobContext, JobFn, JobResult } from "./types";

const PAGE = 1000;

type Cursor = {
  window: { from: string; to: string };
  locations: WalletLocation[];
  phase: "locations" | "unfiltered";
  locIdx: number;
  skip: number;
  locAcc: Acc;
  seenIds: string[];
  uSkip: number;
  uAcc: Record<string, Acc>; // scopeKey → acc for the unfiltered pass
  stats: { rowsSeen: number; scopesWritten: number; rollupRows: number; unfilteredRows: number };
};

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
 * Wallet usage rollup over a UTC window. Per-location pass (every GhlAccount.locationId + HQ), then an unfiltered
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
      stats: { rowsSeen: 0, scopesWritten: 0, rollupRows: 0, unfilteredRows: 0 },
    };
  const seen = new Set(st.seenIds);
  const callsAtStart = apiStats.calls;
  const snapshot = (): Cursor => ({ ...st, seenIds: [...seen] });
  const summary = () => ({ window, ...st.stats, locations: st.locations.length, apiCalls: apiStats.calls - callsAtStart, dryRun: !ctx.apply });

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
        st.stats.rowsSeen += rows.length;
        if (rows.length < PAGE) break;
        st.skip += PAGE;
      }
      await sink(loc.locationId, loc.ghlAccountId, st.locAcc);
      st.locIdx++;
      st.skip = 0;
      st.locAcc = {};
    }
    st.phase = "unfiltered";
  }

  for (;;) {
    if (ctx.shouldYield()) return { done: false, cursor: snapshot(), summary: summary() };
    const rows = await walletTransactionsPage({ skip: st.uSkip, from: window.from, to: window.to });
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      addToAcc((st.uAcc[unfilteredScope(r.locationName)] ??= {}), r);
      st.stats.unfilteredRows++;
    }
    if (rows.length < PAGE) break;
    st.uSkip += PAGE;
  }
  // Always replace both agency scopes (even when empty) so stale rows for the window are cleared.
  for (const scope of ["_agency", "_unattributed"]) await sink(scope, null, st.uAcc[scope] ?? {});
  return { done: true, summary: summary() };
}

export const runWalletUsage: JobFn = (ctx) => runWalletUsageWindow(ctx);
