import { beforeEach, describe, expect, it, vi } from "vitest";

const runWindow = vi.fn();
vi.mock("../jobs/walletUsage", async (orig) => ({ ...(await orig<typeof import("../jobs/walletUsage")>()), runWalletUsageWindow: (...a: unknown[]) => runWindow(...a) }));

import { monthsToRefresh, refreshEligibleAt, refreshWindows, runWalletMonthRefresh } from "../jobs/walletMonthRefresh";
import type { JobContext } from "../jobs/types";

type Row = { month: string; windowsTotal: number; windowsDone: number; mismatchCount: number; completedAt: Date | null };
function fakeDb(rows: Row[] = []) {
  const db: any = {
    walletMonthRefresh: {
      findMany: async ({ where }: any = {}) => rows.filter((r) => !where?.completedAt || r.completedAt !== null),
      findUnique: async ({ where }: any) => rows.find((r) => r.month === where.month) ?? null,
      upsert: async ({ where, create, update }: any) => {
        let r = rows.find((x) => x.month === where.month);
        if (r) Object.assign(r, update);
        else rows.push((r = { windowsDone: 0, mismatchCount: 0, completedAt: null, ...create }));
        return r;
      },
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.month === where.month)!;
        for (const [k, v] of Object.entries(data)) r[k as "windowsDone"] = typeof v === "object" && v !== null && "increment" in (v as object) ? (r[k as "windowsDone"] as number) + (v as { increment: number }).increment : (v as never);
        return r;
      },
    },
  };
  return { db, rows };
}
const ctx = (db: unknown, now: string, o: Partial<JobContext> = {}): JobContext => ({ db: db as never, apply: true, cursor: null, now: new Date(now), shouldYield: () => false, ...o });
const ok = { done: true, summary: { rollupCheck: { mismatchCount: 0 } } };

beforeEach(() => runWindow.mockReset());

describe("windows and eligibility", () => {
  it("covers the Denver month: UTC day 1 of the month through UTC day 1 of the next, in 3-day chunks, contiguous", () => {
    const w = refreshWindows("2026-10");
    expect(w[0].from).toBe("2026-10-01T00:00:00.000Z");
    expect(w[w.length - 1].to).toBe("2026-11-01T23:59:59.999Z"); // covers Oct 31 evening Denver (= Nov 1 UTC)
    for (let i = 1; i < w.length; i++) expect(Date.parse(w[i].from)).toBe(Date.parse(w[i - 1].to) + 1);
    expect(w).toHaveLength(11);
  });
  it("a month is eligible from UTC day 2 of the next month; earlier months already complete are skipped", () => {
    expect(refreshEligibleAt("2026-10").toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(monthsToRefresh(new Date("2026-11-01T20:00:00Z"), new Set())).toEqual([]);
    expect(monthsToRefresh(new Date("2026-11-02T00:00:00Z"), new Set())).toEqual(["2026-10"]);
    expect(monthsToRefresh(new Date("2026-12-05T00:00:00Z"), new Set(["2026-10"]))).toEqual(["2026-11"]);
    expect(monthsToRefresh(new Date("2026-12-05T00:00:00Z"), new Set())).toEqual(["2026-10", "2026-11"]);
  });
});

describe("runWalletMonthRefresh", () => {
  it("no-ops (no GHL work, no writes) when nothing is waiting", async () => {
    const { db, rows } = fakeDb();
    const r = await runWalletMonthRefresh(ctx(db, "2026-10-29T12:00:00Z"));
    expect(r).toMatchObject({ done: true, summary: { noop: true } });
    expect(runWindow).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("advances by windows, records progress, and marks the month complete", async () => {
    const { db, rows } = fakeDb();
    runWindow.mockResolvedValue(ok);
    const r = await runWalletMonthRefresh(ctx(db, "2026-11-03T00:00:00Z"));
    expect(r.done).toBe(true);
    expect(runWindow).toHaveBeenCalledTimes(11);
    expect(rows[0]).toMatchObject({ month: "2026-10", windowsTotal: 11, windowsDone: 11, mismatchCount: 0 });
    expect(rows[0].completedAt).toEqual(new Date("2026-11-03T00:00:00Z"));
    // the next trigger finds nothing to do
    runWindow.mockClear();
    expect(await runWalletMonthRefresh(ctx(db, "2026-11-03T06:00:00Z"))).toMatchObject({ done: true, summary: { noop: true } });
    expect(runWindow).not.toHaveBeenCalled();
  });

  it("resumes across SCHEDULED runs: a run that runs out of budget leaves windowsDone, the next trigger continues there", async () => {
    const { db, rows } = fakeDb();
    // run 1: 4 windows finish, the 5th yields mid-window
    runWindow.mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce({ done: false, cursor: { phase: "locations" }, summary: {} });
    const r1 = await runWalletMonthRefresh(ctx(db, "2026-11-03T00:00:00Z"));
    expect(r1.done).toBe(false);
    expect(r1.cursor).toMatchObject({ month: "2026-10", idx: 4, inner: { phase: "locations" } });
    expect(rows[0]).toMatchObject({ windowsDone: 4, completedAt: null });
    // run 2 (fresh trigger, no cursor — e.g. the continuation cap was hit): resumes at window index 4
    runWindow.mockReset().mockResolvedValue(ok);
    const r2 = await runWalletMonthRefresh(ctx(db, "2026-11-03T02:00:00Z"));
    expect(r2.done).toBe(true);
    expect(runWindow).toHaveBeenCalledTimes(7);
    expect(runWindow.mock.calls[0][1].window.from).toBe(refreshWindows("2026-10")[4].from);
    expect(rows[0]).toMatchObject({ windowsDone: 11 });
    expect(rows[0].completedAt).not.toBeNull();
  });

  it("continues an in-run cursor (the runner's self-continuation) at the same window", async () => {
    const { db } = fakeDb([{ month: "2026-10", windowsTotal: 11, windowsDone: 2, mismatchCount: 0, completedAt: null }]);
    runWindow.mockResolvedValue(ok);
    await runWalletMonthRefresh(ctx(db, "2026-11-03T00:00:00Z", { cursor: { month: "2026-10", idx: 2, inner: { phase: "unfiltered" }, mismatches: 0 } }));
    expect(runWindow.mock.calls[0][0].cursor).toEqual({ phase: "unfiltered" });
    expect(runWindow.mock.calls[0][1].window.from).toBe(refreshWindows("2026-10")[2].from);
  });

  it("counts rollup-vs-row mismatches but still completes", async () => {
    const { db, rows } = fakeDb();
    runWindow.mockResolvedValue({ done: true, summary: { rollupCheck: { mismatchCount: 2 } } });
    await runWalletMonthRefresh(ctx(db, "2026-11-03T00:00:00Z"));
    expect(rows[0].mismatchCount).toBe(22);
    expect(rows[0].completedAt).not.toBeNull();
  });

  it("dry-run writes nothing", async () => {
    const { db, rows } = fakeDb();
    runWindow.mockResolvedValue({ done: true, summary: { rollupCheck: "skipped (dry-run)" } });
    const r = await runWalletMonthRefresh(ctx(db, "2026-11-03T00:00:00Z", { apply: false }));
    expect(r.summary).toMatchObject({ dryRun: true, completed: false });
    expect(rows).toEqual([]);
  });
});
