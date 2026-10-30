import { beforeEach, describe, expect, it, vi } from "vitest";

const page = vi.fn();
vi.mock("../ghlWallet", () => ({ apiStats: { calls: 0 }, walletTransactionsPage: (...a: unknown[]) => page(...a) }));
vi.mock("../jobs/locations", () => ({ listWalletLocations: async () => [{ locationId: "LOC1", ghlAccountId: "acct1" }] }));

import { runWalletUsageWindow } from "../jobs/walletUsage";

const tx = (id: string, amount = -0.01) => ({ id, description: "Outbound SMS: Ref-x", amount, settlementTime: "2026-10-15T12:00:00.000Z", locationName: "Biz" });

describe("wallet rollup counts each transaction id once", () => {
  beforeEach(() => page.mockReset());

  it("a duplicate id inside one GHL response is counted and stored once (rollup == rows)", async () => {
    // location pass returns a dup; unfiltered pass returns nothing new
    page.mockResolvedValueOnce([tx("a"), tx("b"), tx("a"), tx("c"), tx("b")]).mockResolvedValueOnce([tx("a"), tx("b"), tx("c")]);
    const rollups: Record<string, { count: number; micros: number }[]> = {};
    const created: string[] = [];
    const db: any = {
      walletTransaction: { createMany: async ({ data }: any) => { created.push(...data.map((d: any) => d.id)); return { count: data.length }; } },
      ghlAccount: { updateMany: async () => ({ count: 0 }) },
      usageRollup: { deleteMany: async () => ({}), createMany: async ({ data }: any) => { (rollups[data[0]?.scopeKey ?? "x"] ??= []).push(...data); return {}; } },
      $transaction: async (ops: unknown[]) => Promise.all(ops),
      $queryRaw: async () => [],
    };
    const r = await runWalletUsageWindow({ db, apply: true, cursor: null, now: new Date("2026-10-30T12:00:00Z"), shouldYield: () => false }, { window: { from: "2026-10-15T00:00:00.000Z", to: "2026-10-15T23:59:59.999Z" } });
    expect(r.done).toBe(true);
    expect(created.sort()).toEqual(["a", "b", "c"]);
    const loc = rollups["LOC1"].find((x: any) => x.category === "outbound_sms") as any;
    expect(loc.count).toBe(3); // not 5
    expect(r.summary).toMatchObject({ duplicateIds: 2 });
  });
});
