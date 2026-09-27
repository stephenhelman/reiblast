import { beforeEach, describe, expect, it, vi } from "vitest";

const pages: { locationId?: string }[] = [];
let rowsByLocation: Record<string, any[]> = {};

vi.mock("../ghlWallet", () => ({
  apiStats: { calls: 0 },
  walletTransactionsPage: vi.fn(async (opts: { locationId?: string }) => {
    pages.push({ locationId: opts.locationId });
    return opts.locationId ? (rowsByLocation[opts.locationId] ?? []) : [];
  }),
}));

import { runWalletUsageWindow } from "../jobs/walletUsage";
import { latestLocationName, usableLocationName } from "../usageRollup";

const row = (id: string, locationName: string | null, settlementTime: string) => ({ id, description: "Outbound SMS: x", amount: -0.01, locationName, settlementTime });

describe("latestLocationName / usableLocationName", () => {
  it("blank and \"-\" are not usable", () => {
    for (const n of [null, undefined, "", "   ", "-", " - "]) expect(usableLocationName(n)).toBeNull();
    expect(usableLocationName("  Acme ")).toBe("Acme");
  });
  it("keeps the most recent usable name by settlementTime, regardless of row order", () => {
    const rows = [row("2", "New Name", "2026-09-02 10:00:00.000"), row("1", "Old Name", "2026-09-01 10:00:00.000"), row("3", "-", "2026-09-03 10:00:00.000"), row("4", null, "2026-09-04 10:00:00.000")];
    expect(latestLocationName(null, rows)).toEqual({ name: "New Name", time: "2026-09-02 10:00:00.000" });
  });
  it("folds across pages and returns null when nothing usable", () => {
    const first = latestLocationName(null, [row("1", "Old", "2026-09-01 10:00:00.000")]);
    expect(latestLocationName(first, [row("2", "Newer", "2026-09-05 10:00:00.000")])?.name).toBe("Newer");
    expect(latestLocationName(first, [row("3", "Older", "2026-08-01 10:00:00.000")])?.name).toBe("Old");
    expect(latestLocationName(null, [row("4", "-", "2026-09-01 10:00:00.000")])).toBeNull();
  });
});

type Acct = { id: string; locationId: string; locationName: string | null; locationNameUpdatedAt?: Date };
function fakeDb(accounts: Acct[]) {
  const updates: unknown[] = [];
  const db: any = {
    ghlAccount: {
      findMany: async () => accounts.map((a) => ({ id: a.id, locationId: a.locationId })),
      updateMany: async ({ where, data }: any) => {
        updates.push({ where, data });
        const a = accounts.find((x) => x.id === where.id);
        if (!a || where.accountType !== "member") return { count: 0 };
        const differs = a.locationName === null || a.locationName !== data.locationName; // mirrors the OR in the where clause
        if (!differs) return { count: 0 };
        a.locationName = data.locationName;
        a.locationNameUpdatedAt = data.locationNameUpdatedAt;
        return { count: 1 };
      },
    },
    walletTransaction: { createMany: async ({ data }: any) => ({ count: data.length }) },
    usageRollup: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    $queryRaw: async () => [],
  };
  return { db, updates };
}
const ctx = (db: any, apply = true) => ({ db, apply, cursor: null, now: new Date("2026-09-27T05:00:00Z"), shouldYield: () => false });
const window = { from: "2026-09-25T00:00:00.000Z", to: "2026-09-25T23:59:59.999Z" };

beforeEach(() => {
  pages.length = 0;
  rowsByLocation = {};
  delete process.env.GHL_HQ_LOCATION_ID;
});

describe("wallet_usage records member location names", () => {
  it("writes the newest usable name (member only) and stamps the time", async () => {
    const accounts: Acct[] = [{ id: "a1", locationId: "L1", locationName: null }];
    rowsByLocation.L1 = [row("1", "Old Name", "2026-09-25 01:00:00.000"), row("2", "New Name", "2026-09-25 09:00:00.000"), row("3", "-", "2026-09-25 23:00:00.000")];
    const { db, updates } = fakeDb(accounts);
    const r = await runWalletUsageWindow(ctx(db), { window });
    expect(accounts[0].locationName).toBe("New Name");
    expect(accounts[0].locationNameUpdatedAt).toEqual(new Date("2026-09-27T05:00:00Z"));
    expect((r.summary as any).namesUpdated).toBe(1);
    expect((updates[0] as any).where).toMatchObject({ id: "a1", accountType: "member" });
  });

  it("updates only when it differs", async () => {
    const accounts: Acct[] = [{ id: "a1", locationId: "L1", locationName: "Same Name" }, { id: "a2", locationId: "L2", locationName: "Stale Name" }];
    rowsByLocation.L1 = [row("1", "Same Name", "2026-09-25 09:00:00.000")];
    rowsByLocation.L2 = [row("2", "Renamed Co", "2026-09-25 09:00:00.000")];
    const { db } = fakeDb(accounts);
    const r = await runWalletUsageWindow(ctx(db), { window });
    expect((r.summary as any).namesUpdated).toBe(1);
    expect(accounts.map((a) => a.locationName)).toEqual(["Same Name", "Renamed Co"]);
  });

  it("locations with only blank names, or no rows, are left alone", async () => {
    const accounts: Acct[] = [{ id: "a1", locationId: "L1", locationName: "Keep Me" }, { id: "a2", locationId: "L2", locationName: null }];
    rowsByLocation.L1 = [row("1", "-", "2026-09-25 09:00:00.000"), row("2", "", "2026-09-25 10:00:00.000")];
    const { db, updates } = fakeDb(accounts);
    await runWalletUsageWindow(ctx(db), { window });
    expect(updates).toHaveLength(0);
    expect(accounts.map((a) => a.locationName)).toEqual(["Keep Me", null]);
  });

  it("HQ (no account) is never written; dry-run never writes", async () => {
    process.env.GHL_HQ_LOCATION_ID = "HQ";
    rowsByLocation.HQ = [row("1", "REI Blast HQ", "2026-09-25 09:00:00.000")];
    rowsByLocation.L1 = [row("2", "Acme", "2026-09-25 09:00:00.000")];
    const accounts: Acct[] = [{ id: "a1", locationId: "L1", locationName: null }];
    const live = fakeDb(accounts);
    await runWalletUsageWindow(ctx(live.db), { window });
    expect(live.updates).toHaveLength(1); // only L1
    const dry = fakeDb([{ id: "a1", locationId: "L1", locationName: null }]);
    await runWalletUsageWindow(ctx(dry.db, false), { window });
    expect(dry.updates).toHaveLength(0);
  });

  it("makes no extra API calls: one page per location plus the unfiltered pass", async () => {
    rowsByLocation.L1 = [row("1", "Acme", "2026-09-25 09:00:00.000")];
    rowsByLocation.L2 = [row("2", "Beta", "2026-09-25 09:00:00.000")];
    const { db } = fakeDb([{ id: "a1", locationId: "L1", locationName: null }, { id: "a2", locationId: "L2", locationName: null }]);
    await runWalletUsageWindow(ctx(db), { window });
    expect(pages.filter((p) => p.locationId).length).toBe(2);
    expect(pages.filter((p) => !p.locationId).length).toBe(1);
    expect(pages).toHaveLength(3);
  });
});
