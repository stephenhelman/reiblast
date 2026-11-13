import type { PrismaClient } from "@prisma/client";
import { addMonths, currentDenverMonth } from "@/lib/billing/reports/denver";
import { variantLabel } from "@/lib/campaign/registry";

/**
 * Scorecard data: pure computation (buildScorecard) over CampaignStats + CampaignSnapshot rows, and a thin loader. The ONLY input that
 * selects whose data is read is the locationId argument — callers must take it from a verified session / token, never from the URL.
 */

/** A variant needs at least this many entered contacts before it can be called the leader of its list type. */
export const MIN_VARIANT_ENTERED = 50;

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;

export type StatsRow = {
  listType: string; listName: string; variant: string;
  entered: number; replied: number; errored: number; noResponse: number;
  replied1: number; replied2: number; replied3: number; replied4: number; replied5: number; replied6: number; replied7: number;
  errored1: number; errored2: number; errored3: number; errored4: number; errored5: number; errored6: number; errored7: number;
  catInterested: number; catNotNow: number; catWrongNumber: number; catOptOut: number; catNeedsReply: number; catOther: number;
};
export type SnapshotRow = { month: string; entered: number; replied: number; errored: number; noResponse: number };

export type Totals = { entered: number; replied: number; errored: number };
export type WithRates = Totals & { replyRate: number | null; errorRate: number | null };

export type ListCard = WithRates & { listType: string; listName: string };
export type OpenerVariant = { variant: string; label: string; entered: number; replied: number; replyRate: number | null };
export type OpenerGroup = { listType: string; variants: OpenerVariant[]; leader: string | null; enoughData: boolean };
export type StepRow = { step: number; replied: number; errored: number };
export type Unlabeled = WithRates & { rows: number };
export type CategoryCounts = { interested: number; notNow: number; wrongNumber: number; optOut: number; needsReply: number; other: number };

export type MonthComparison =
  | { kind: "no_snapshot"; allTime: WithRates }
  | {
      kind: "ok";
      thisMonth: { month: string; stats: WithRates; spansMonths: boolean; since: string | null };
      /** null when there is no snapshot for the month just ended (a missed snapshot). */
      lastMonth: { month: string; stats: WithRates; includesEarlier: boolean } | null;
    };

export type ScorecardData = {
  empty: boolean;
  totals: WithRates;
  lists: ListCard[];
  openers: OpenerGroup[];
  steps: StepRow[];
  unlabeled: Unlabeled | null;
  month: MonthComparison;
  categories: CategoryCounts | null;
};

export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const withRates = (t: Totals): WithRates => ({ ...t, replyRate: rate(t.replied, t.entered), errorRate: rate(t.errored, t.entered) });
const sum = (rows: StatsRow[], f: keyof StatsRow): number => rows.reduce((n, r) => n + (r[f] as number), 0);
const totalsOf = (rows: StatsRow[]): Totals => ({ entered: sum(rows, "entered"), replied: sum(rows, "replied"), errored: sum(rows, "errored") });
const clamp0 = (n: number) => Math.max(0, n);
const diff = (a: Totals, b: Totals): Totals => ({ entered: clamp0(a.entered - b.entered), replied: clamp0(a.replied - b.replied), errored: clamp0(a.errored - b.errored) });
const snapTotals = (s: SnapshotRow): Totals => ({ entered: s.entered, replied: s.replied, errored: s.errored });

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) { const k = key(i); m.set(k, [...(m.get(k) ?? []), i]); }
  return m;
}

export function buildOpeners(rows: StatsRow[]): OpenerGroup[] {
  const out: OpenerGroup[] = [];
  for (const [listType, group] of groupBy(rows, (r) => r.listType)) {
    const variants: OpenerVariant[] = [...groupBy(group, (r) => r.variant)].map(([variant, vr]) => {
      const t = totalsOf(vr);
      return { variant, label: variantLabel(variant), entered: t.entered, replied: t.replied, replyRate: rate(t.replied, t.entered) };
    }).sort((a, b) => b.entered - a.entered || a.label.localeCompare(b.label));
    // A leader needs a comparison (2+ variants), enough data on EVERY variant, and a strict winner (no tie at the top).
    const enoughData = variants.length >= 2 && variants.every((v) => v.entered >= MIN_VARIANT_ENTERED);
    let leader: string | null = null;
    if (enoughData) {
      const best = Math.max(...variants.map((v) => v.replyRate ?? 0));
      const top = variants.filter((v) => (v.replyRate ?? 0) === best);
      if (top.length === 1) leader = top[0].variant;
    }
    out.push({ listType, variants, leader, enoughData });
  }
  return out.sort((a, b) => a.listType.localeCompare(b.listType));
}

export function buildMonth(rows: StatsRow[], snapshots: SnapshotRow[], now: Date): MonthComparison {
  const live = totalsOf(rows);
  const cur = currentDenverMonth(now);
  const past = snapshots.filter((s) => s.month < cur).sort((a, b) => b.month.localeCompare(a.month));
  if (past.length === 0) return { kind: "no_snapshot", allTime: withRates(live) };

  const latest = past[0];
  const prevMonth = addMonths(cur, -1);
  const spansMonths = latest.month !== prevMonth; // a month-end snapshot was missed → "this month" really covers several months
  const thisMonth = { month: cur, stats: withRates(diff(live, snapTotals(latest))), spansMonths, since: spansMonths ? latest.month : null };

  let lastMonth: { month: string; stats: WithRates; includesEarlier: boolean } | null = null;
  if (!spansMonths) {
    const before = past.find((s) => s.month < latest.month);
    // With no earlier snapshot, the first snapshot is cumulative since the start, so it is shown as-is and flagged.
    lastMonth = before
      ? { month: latest.month, stats: withRates(diff(snapTotals(latest), snapTotals(before))), includesEarlier: false }
      : { month: latest.month, stats: withRates(snapTotals(latest)), includesEarlier: true };
  }
  return { kind: "ok", thisMonth, lastMonth };
}

export function buildScorecard(rows: StatsRow[], snapshots: SnapshotRow[], now = new Date()): ScorecardData {
  const labeled = rows.filter((r) => r.listType !== "");
  const unlabeledRows = rows.filter((r) => r.listType === "");

  const lists: ListCard[] = [...groupBy(labeled, (r) => `${r.listType}\u0000${r.listName}`).values()]
    .map((g) => ({ listType: g[0].listType, listName: g[0].listName, ...withRates(totalsOf(g)) }))
    .sort((a, b) => b.entered - a.entered || `${a.listType}${a.listName}`.localeCompare(`${b.listType}${b.listName}`));

  const steps: StepRow[] = STEPS.map((n) => ({ step: n, replied: sum(rows, `replied${n}` as keyof StatsRow), errored: sum(rows, `errored${n}` as keyof StatsRow) }));

  const cats: CategoryCounts = {
    interested: sum(rows, "catInterested"), notNow: sum(rows, "catNotNow"), wrongNumber: sum(rows, "catWrongNumber"),
    optOut: sum(rows, "catOptOut"), needsReply: sum(rows, "catNeedsReply"), other: sum(rows, "catOther"),
  };

  return {
    empty: rows.length === 0,
    totals: withRates(totalsOf(rows)),
    lists,
    openers: buildOpeners(labeled),
    steps,
    unlabeled: unlabeledRows.length ? { ...withRates(totalsOf(unlabeledRows)), rows: unlabeledRows.length } : null,
    month: buildMonth(rows, snapshots, now),
    categories: Object.values(cats).some((n) => n > 0) ? cats : null,
  };
}

type Db = Pick<PrismaClient, "campaignStats" | "campaignSnapshot">;

/** Reads one location's rows (both queries use the (locationId, …) unique-index prefix) and builds the scorecard. */
export async function loadScorecard(db: Db, locationId: string, now = new Date()): Promise<ScorecardData> {
  const [rows, snaps] = await Promise.all([
    db.campaignStats.findMany({ where: { locationId } }),
    db.campaignSnapshot.findMany({
      where: { locationId },
      orderBy: { month: "desc" },
      take: 6,
      select: { month: true, entered: true, replied: true, errored: true, noResponse: true },
    }),
  ]);
  return buildScorecard(rows as unknown as StatsRow[], snaps, now);
}
