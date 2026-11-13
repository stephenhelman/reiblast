import { describe, expect, it } from "vitest";
import { MIN_VARIANT_ENTERED, buildScorecard, type SnapshotRow, type StatsRow } from "../data";

const Z = { entered: 0, replied: 0, errored: 0, noResponse: 0, replied1: 0, replied2: 0, replied3: 0, replied4: 0, replied5: 0, replied6: 0, replied7: 0, errored1: 0, errored2: 0, errored3: 0, errored4: 0, errored5: 0, errored6: 0, errored7: 0, catInterested: 0, catNotNow: 0, catWrongNumber: 0, catOptOut: 0, catNeedsReply: 0, catOther: 0 };
const row = (o: Partial<StatsRow>): StatsRow => ({ listType: "Probate", listName: "Oct", variant: "probate-1", ...Z, ...o });
const snap = (month: string, o: Partial<SnapshotRow> = {}): SnapshotRow => ({ month, entered: 0, replied: 0, errored: 0, noResponse: 0, ...o });
const NOW = new Date("2026-11-15T18:00:00Z"); // Denver: 2026-11

describe("empty + totals", () => {
  it("no rows → empty, no categories, no_snapshot", () => {
    const d = buildScorecard([], [], NOW);
    expect(d.empty).toBe(true);
    expect(d.categories).toBeNull();
    expect(d.lists).toEqual([]);
  });
  it("rates are null when nothing was sent (no divide by zero)", () => {
    const d = buildScorecard([row({ entered: 0, replied: 0 })], [], NOW);
    expect(d.totals.replyRate).toBeNull();
    expect(d.lists[0].errorRate).toBeNull();
  });
});

describe("lists", () => {
  it("one card per (listType, listName), summing variants, with reply/error rates; sorted by sent", () => {
    const d = buildScorecard([
      row({ variant: "probate-1", entered: 100, replied: 10, errored: 5 }),
      row({ variant: "probate-2", entered: 100, replied: 20, errored: 5 }),
      row({ listName: "Nov", entered: 500, replied: 5 }),
    ], [], NOW);
    expect(d.lists).toHaveLength(2);
    expect(d.lists[0]).toMatchObject({ listName: "Nov", entered: 500 });
    expect(d.lists[1]).toMatchObject({ listName: "Oct", entered: 200, replied: 30, errored: 10, replyRate: 0.15, errorRate: 0.05 });
  });
  it("rows with listType '' are never list cards; they are grouped under unlabeled", () => {
    const d = buildScorecard([row({ listType: "", listName: "", variant: "", entered: 40, replied: 4 }), row({ listType: "", listName: "x", variant: "a", entered: 10, errored: 1 }), row({ entered: 5 })], [], NOW);
    expect(d.lists).toHaveLength(1);
    expect(d.unlabeled).toMatchObject({ entered: 50, replied: 4, errored: 1, rows: 2 });
    expect(buildScorecard([row({})], [], NOW).unlabeled).toBeNull();
  });
});

describe("openers", () => {
  const two = (a: number, ar: number, b: number, br: number) => [row({ variant: "probate-1", entered: a, replied: ar }), row({ listName: "Nov", variant: "probate-2", entered: b, replied: br })];
  it("aggregates a variant across lists and highlights the leader when every variant has ≥ 50 entered", () => {
    const d = buildScorecard(two(MIN_VARIANT_ENTERED, 5, MIN_VARIANT_ENTERED, 10), [], NOW);
    expect(d.openers).toHaveLength(1);
    expect(d.openers[0]).toMatchObject({ listType: "Probate", enoughData: true, leader: "probate-2" });
    expect(d.openers[0].variants.find((v) => v.variant === "probate-2")).toMatchObject({ label: "Probate 2", replyRate: 0.2 });
  });
  it("no leader when ANY variant has < 50 entered", () => {
    const o = buildScorecard(two(49, 1, 500, 300), [], NOW).openers[0];
    expect(o.enoughData).toBe(false);
    expect(o.leader).toBeNull();
  });
  it("a single variant, or an exact tie, has no leader", () => {
    expect(buildScorecard([row({ entered: 500, replied: 50 })], [], NOW).openers[0]).toMatchObject({ enoughData: false, leader: null });
    expect(buildScorecard(two(100, 10, 100, 10), [], NOW).openers[0]).toMatchObject({ enoughData: true, leader: null });
  });
  it("groups per list type and unlabeled-variant rows keep their own 'Unlabeled' entry", () => {
    const d = buildScorecard([row({ variant: "", entered: 10 }), row({ listType: "Absentee", variant: "absentee-1", entered: 10 })], [], NOW);
    expect(d.openers.map((g) => g.listType)).toEqual(["Absentee", "Probate"]);
    expect(d.openers[1].variants[0].label).toBe("Unlabeled");
  });
});

describe("steps", () => {
  it("sums replied1–7 / errored1–7 across every row, unlabeled included", () => {
    const d = buildScorecard([row({ replied1: 3, errored2: 1 }), row({ listType: "", variant: "", replied1: 2, replied7: 4, errored2: 2 })], [], NOW);
    expect(d.steps).toHaveLength(7);
    expect(d.steps[0]).toEqual({ step: 1, replied: 5, errored: 0 });
    expect(d.steps[1]).toEqual({ step: 2, replied: 0, errored: 3 });
    expect(d.steps[6]).toEqual({ step: 7, replied: 4, errored: 0 });
  });
});

describe("this month vs last", () => {
  const live = [row({ entered: 1000, replied: 100, errored: 20 })];
  it("no snapshot → no_snapshot with all-time totals", () => {
    const m = buildScorecard(live, [], NOW).month;
    expect(m).toMatchObject({ kind: "no_snapshot", allTime: { entered: 1000 } });
  });
  it("a snapshot for the current month alone doesn't count (only months before it)", () => {
    expect(buildScorecard(live, [snap("2026-11", { entered: 5 })], NOW).month.kind).toBe("no_snapshot");
  });
  it("this month = live − last snapshot; last month = last snapshot − the one before", () => {
    const m = buildScorecard(live, [snap("2026-10", { entered: 800, replied: 70, errored: 15 }), snap("2026-09", { entered: 500, replied: 40, errored: 10 })], NOW).month;
    expect(m.kind).toBe("ok");
    if (m.kind !== "ok") return;
    expect(m.thisMonth).toMatchObject({ month: "2026-11", spansMonths: false, since: null, stats: { entered: 200, replied: 30, errored: 5, replyRate: 0.15 } });
    expect(m.lastMonth).toMatchObject({ month: "2026-10", includesEarlier: false, stats: { entered: 300, replied: 30, errored: 5 } });
  });
  it("only one snapshot → last month is that snapshot as-is, flagged as including earlier activity", () => {
    const m = buildScorecard(live, [snap("2026-10", { entered: 800, replied: 70, errored: 15 })], NOW).month;
    if (m.kind !== "ok") throw new Error("expected ok");
    expect(m.lastMonth).toMatchObject({ includesEarlier: true, stats: { entered: 800 } });
  });
  it("a missed month-end snapshot is flagged: 'this month' spans months and last month is unavailable", () => {
    const m = buildScorecard(live, [snap("2026-09", { entered: 500 })], NOW).month;
    if (m.kind !== "ok") throw new Error("expected ok");
    expect(m.thisMonth).toMatchObject({ spansMonths: true, since: "2026-09", stats: { entered: 500 } });
    expect(m.lastMonth).toBeNull();
  });
  it("never goes negative if a snapshot exceeds live totals", () => {
    const m = buildScorecard(live, [snap("2026-10", { entered: 5000 })], NOW).month;
    if (m.kind !== "ok") throw new Error("expected ok");
    expect(m.thisMonth.stats.entered).toBe(0);
  });
  it("uses the Denver month, not UTC (Nov 1 03:00 UTC is still Oct 31 in Denver)", () => {
    const m = buildScorecard(live, [snap("2026-10", { entered: 800 })], new Date("2026-11-01T03:00:00Z")).month;
    expect(m.kind).toBe("no_snapshot"); // current month is still 2026-10
  });
});

describe("reply categories", () => {
  it("hidden (null) unless any cat* > 0; otherwise summed", () => {
    expect(buildScorecard([row({})], [], NOW).categories).toBeNull();
    const c = buildScorecard([row({ catInterested: 2 }), row({ listName: "b", catInterested: 1, catOptOut: 4 })], [], NOW).categories;
    expect(c).toMatchObject({ interested: 3, optOut: 4, notNow: 0 });
  });
});
