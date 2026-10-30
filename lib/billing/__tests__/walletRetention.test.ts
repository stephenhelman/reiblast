import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
vi.mock("../jobs/walletUsage", async (orig) => ({ ...(await orig<typeof import("../jobs/walletUsage")>()), checkRollupAgainstRows: (...a: unknown[]) => check(...a) }));

import { getJobHealth } from "../jobHealth";
import { retentionDays, retentionEnabled, runWalletRetention } from "../jobs/walletRetention";
import type { JobContext } from "../jobs/types";

const NOW = new Date("2027-02-10T12:00:00Z");
function fakeDb(rowDays: string[], complete: string[]) {
  const rows = rowDays.map((d, i) => ({ id: `w${i}`, settlementTime: new Date(`${d}T12:00:00Z`) }));
  const db: any = {
    walletMonthRefresh: { findMany: async () => complete.map((month) => ({ month })) },
    walletTransaction: {
      findFirst: async ({ where }: any) => rows.filter((r) => r.settlementTime < where.settlementTime.lt).sort((a, b) => +a.settlementTime - +b.settlementTime)[0] ?? null,
      count: async ({ where }: any) => rows.filter((r) => r.settlementTime >= where.settlementTime.gte && r.settlementTime < where.settlementTime.lt).length,
    },
    $executeRaw: async (_s: unknown, from: Date, to: Date) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].settlementTime >= from && rows[i].settlementTime < to) { rows.splice(i, 1); n++; }
      return n;
    },
  };
  return { db, rows };
}
const ctx = (db: unknown, o: Partial<JobContext> = {}): JobContext => ({ db: db as never, apply: true, cursor: null, now: NOW, shouldYield: () => false, ...o });
const env = { ...process.env };
beforeEach(() => check.mockReset().mockResolvedValue([]));
afterEach(() => { process.env = { ...env }; });

describe("wallet_retention ships disabled", () => {
  it("does nothing, not even a query, unless WALLET_RETENTION_ENABLED=true", async () => {
    delete process.env.WALLET_RETENTION_ENABLED;
    const { db, rows } = fakeDb(["2026-10-05"], ["2026-10"]);
    const r = await runWalletRetention(ctx(db));
    expect(r).toMatchObject({ done: true, summary: { disabled: true } });
    expect(rows).toHaveLength(1);
    expect(retentionEnabled({ WALLET_RETENTION_ENABLED: "yes" })).toBe(false);
    expect(retentionEnabled({ WALLET_RETENTION_ENABLED: "true" })).toBe(true);
  });
  it("is hidden from Health (not 'stale') until enabled", async () => {
    const db: any = { jobRun: { findMany: async () => [] } };
    expect((await getJobHealth(db, NOW, {})).map((j) => j.job)).not.toContain("wallet_retention");
    expect((await getJobHealth(db, NOW, { WALLET_RETENTION_ENABLED: "true" })).map((j) => j.job)).toContain("wallet_retention");
  });
  it("days: default 90, floor 60", () => {
    expect(retentionDays({})).toBe(90);
    expect(retentionDays({ WALLET_RETENTION_DAYS: "120" })).toBe(120);
    expect(retentionDays({ WALLET_RETENTION_DAYS: "10" })).toBe(90);
  });
});

describe("when enabled", () => {
  beforeEach(() => { process.env.WALLET_RETENTION_ENABLED = "true"; });

  it("deletes only rows older than 90 days, from refreshed months with a matching rollup", async () => {
    const { db, rows } = fakeDb(["2026-10-05", "2026-10-06", "2026-12-20", "2027-02-01"], ["2026-10"]);
    const r = await runWalletRetention(ctx(db));
    // cutoff = 2026-11-12: the two October days go; the Dec/Feb rows are inside the window, untouched
    expect(r.summary).toMatchObject({ deleted: 2, daysCleared: 2 });
    expect(rows.map((x) => x.id)).toEqual(["w2", "w3"]);
  });

  it("refuses to delete a day whose statement month wallet refresh isn't complete", async () => {
    const { db, rows } = fakeDb(["2026-10-05"], []);
    const r = await runWalletRetention(ctx(db));
    expect(r.summary).toMatchObject({ deleted: 0, stoppedAt: "2026-10-05", reason: expect.stringMatching(/not complete for 2026-10/) });
    expect(rows).toHaveLength(1);
  });

  it("refuses when UsageRollup disagrees with the raw rows", async () => {
    check.mockResolvedValue([{ scopeKey: "x", day: "2026-10-05", category: "outbound_sms" }]);
    const { db, rows } = fakeDb(["2026-10-05"], ["2026-10"]);
    const r = await runWalletRetention(ctx(db));
    expect(r.summary).toMatchObject({ deleted: 0, reason: "UsageRollup disagrees with raw rows", mismatchCount: 1 });
    expect(rows).toHaveLength(1);
  });

  it("dry-run deletes nothing", async () => {
    const { db, rows } = fakeDb(["2026-10-05"], ["2026-10"]);
    const r = await runWalletRetention(ctx(db, { apply: false }));
    expect(r.summary).toMatchObject({ dryRun: true, wouldDeleteFirstDay: { day: "2026-10-05", rows: 1 } });
    expect(rows).toHaveLength(1);
  });
});
