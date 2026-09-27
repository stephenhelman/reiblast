import { describe, expect, it } from "vitest";
import type { BillingState } from "@prisma/client";
import { buildBadges, buildBalanceAlerts, classifyBalance, denverDate, denverWindowStart, getInactiveUsage, type BalanceLevel } from "@/lib/billing/reports/health";

const ok = (balance: string) => ({ status: "ok", balance });
const neg = ok("-1.50");
const pos = ok("12.00");
const unavailable = { status: "unavailable", balance: null };
const error = { status: "error", balance: null };

const level = (state: BillingState | null, snap: Parameters<typeof classifyBalance>[1]): BalanceLevel | null => classifyBalance(state, snap)?.level ?? null;

describe("classifyBalance — trial / active / payment_failed", () => {
  for (const state of ["trial", "active", "payment_failed"] as const) {
    it(`${state}: unavailable and error are ALERTs ("expected a wallet")`, () => {
      expect(classifyBalance(state, unavailable)).toEqual({ level: "alert", reason: "expected a wallet (unavailable)" });
      expect(classifyBalance(state, error)).toEqual({ level: "alert", reason: "expected a wallet (error)" });
    });
    it(`${state}: negative is a WARNING; zero/positive is fine; no snapshot is not alerted`, () => {
      expect(classifyBalance(state, neg)).toEqual({ level: "warning", reason: "negative balance" });
      expect(level(state, ok("0.000000"))).toBeNull();
      expect(level(state, pos)).toBeNull();
      expect(level(state, null)).toBeNull();
    });
  }
});

describe("classifyBalance — paused", () => {
  it("negative is INFO (expected)", () => expect(classifyBalance("paused", neg)).toEqual({ level: "info", reason: "negative while paused (expected)" }));
  it("unavailable / error / positive / none are not shown", () => {
    for (const s of [unavailable, error, pos, null]) expect(level("paused", s)).toBeNull();
  });
});

describe("classifyBalance — inactive / churned / null", () => {
  it("inactive and churned are never alerted, whatever the snapshot", () => {
    for (const state of ["inactive", "churned"] as const) for (const s of [neg, pos, unavailable, error, null]) expect(level(state, s)).toBeNull();
  });
  it("null billingState is ALWAYS an ALERT (state not seeded), regardless of balance or snapshot", () => {
    for (const s of [neg, pos, unavailable, error, null]) expect(classifyBalance(null, s)).toEqual({ level: "alert", reason: "state not seeded" });
  });
});

const member = (locationId: string | null, billingState: BillingState | null) => ({ accountId: `acct_${locationId ?? "none"}`, locationId, billingState, locationName: locationId ? `Name ${locationId}` : null, businessName: null });
const snapMap = (o: Record<string, { status: string; balance: string | null }>) => new Map(Object.entries(o).map(([k, v]) => [k, { takenOn: "2026-09-27", ...v }]));

describe("buildBalanceAlerts (per member account)", () => {
  it("groups by state, orders alert → warning → info then most negative first", () => {
    const alerts = buildBalanceAlerts(
      [member("A", "active"), member("B", "trial"), member("C", "paused"), member("D", "trial"), member("E", "churned"), member("F", "inactive"), member("G", "payment_failed")],
      snapMap({ A: ok("-2"), B: unavailable, C: ok("-9"), D: ok("-5"), E: ok("-100"), F: unavailable, G: error }),
    );
    expect(alerts.map((a) => `${a.level}:${a.locationId}`)).toEqual(["alert:B", "alert:G", "warning:D", "warning:A", "info:C"]);
  });

  it("a null-state member is alerted even with no snapshot at all", () => {
    const [a] = buildBalanceAlerts([member("N", null)], new Map());
    expect(a).toMatchObject({ locationId: "N", level: "alert", reason: "state not seeded", status: "no snapshot", balance: null, billingState: null });
  });

  it("accounts WITHOUT a location (still onboarding) are never alerted — not even with a null billingState", () => {
    const noLoc = (id: string, state: BillingState | null) => ({ ...member(null, state), accountId: id });
    expect(buildBalanceAlerts([noLoc("a", null), noLoc("b", "trial"), noLoc("c", "paused"), noLoc("d", "active")], new Map())).toEqual([]);
  });

  it("a null-state member WITH a location still alerts, next to onboarding accounts that don't", () => {
    const alerts = buildBalanceAlerts([{ ...member(null, null), accountId: "onboarding" }, member("L1", null)], new Map());
    expect(alerts.map((a) => [a.accountId, a.locationId, a.reason])).toEqual([["acct_L1", "L1", "state not seeded"]]);
  });

  it("snapshots with no member account (HQ) never produce an alert", () => {
    expect(buildBalanceAlerts([member("A", "active")], snapMap({ A: pos, HQ: neg, GHOST: unavailable }))).toEqual([]);
  });
});

describe("buildBadges use the same rules", () => {
  const base = { jobs: [], quality: { unclassifiedCount: 0, unmatchedTotal: 0, failedEventCount: 0 }, db: { level: "ok" as const, pct: 10 } };
  const badge = (k: string, x: Parameters<typeof buildBadges>[0]) => buildBadges(x).find((b) => b.key === k)!;

  it("balance badge counts alerts and warnings (info is not counted)", () => {
    expect(badge("balances", { ...base, balances: { counts: { alert: 2, warning: 3, info: 9 } }, inactiveUsage: { rows: [] } })).toMatchObject({ value: "2 alert · 3 warning", tone: "bad" });
    expect(badge("balances", { ...base, balances: { counts: { alert: 0, warning: 1, info: 0 } }, inactiveUsage: { rows: [] } }).tone).toBe("warn");
    expect(badge("balances", { ...base, balances: { counts: { alert: 0, warning: 0, info: 4 } }, inactiveUsage: { rows: [] } }).tone).toBe("ok");
  });
  it("usage-on-non-active is bad when any row exists", () => {
    expect(badge("inactive-usage", { ...base, balances: { counts: { alert: 0, warning: 0, info: 0 } }, inactiveUsage: { rows: [{}] } })).toMatchObject({ value: "1", tone: "bad" });
    expect(badge("inactive-usage", { ...base, balances: { counts: { alert: 0, warning: 0, info: 0 } }, inactiveUsage: { rows: [] } })).toMatchObject({ value: "0", tone: "ok" });
  });
});

describe("Denver 7-day window", () => {
  it("uses the Denver calendar date, not UTC", () => {
    expect(denverDate(new Date("2026-09-27T03:00:00Z"))).toBe("2026-09-26"); // 21:00 MDT the day before
    expect(denverDate(new Date("2026-09-27T07:00:00Z"))).toBe("2026-09-27"); // 01:00 MDT
  });
  it("window = today plus the 6 previous Denver days", () => {
    expect(denverWindowStart(new Date("2026-09-27T18:00:00Z"), 7)).toBe("2026-09-21");
    expect(denverWindowStart(new Date("2026-09-27T03:00:00Z"), 7)).toBe("2026-09-20");
  });
  it("handles standard time and month/year boundaries", () => {
    expect(denverDate(new Date("2026-01-01T05:00:00Z"))).toBe("2025-12-31"); // 22:00 MST
    expect(denverWindowStart(new Date("2026-01-01T05:00:00Z"), 7)).toBe("2025-12-25");
    expect(denverWindowStart(new Date("2026-03-05T12:00:00Z"), 7)).toBe("2026-02-27");
  });
});

describe("getInactiveUsage", () => {
  const fake = (accounts: any[], usage: any[]) => {
    const calls: any = {};
    const db: any = {
      ghlAccount: { findMany: async (args: any) => ((calls.where = args.where), accounts) },
      $queryRaw: async () => ((calls.queried = true), usage),
    };
    return { db, calls };
  };
  const acct = (locationId: string, billingState: BillingState) => ({ locationId, billingState, locationName: `N-${locationId}`, user: { businessName: null } });

  it("queries only member accounts in paused/inactive/churned", async () => {
    const { db, calls } = fake([], []);
    await getInactiveUsage(db, new Date("2026-09-27T18:00:00Z"));
    expect(calls.where).toMatchObject({ accountType: "member", billingState: { in: ["paused", "inactive", "churned"] }, locationId: { not: null } });
  });

  it("no candidate accounts → no usage query, empty result", async () => {
    const { db, calls } = fake([], []);
    expect(await getInactiveUsage(db, new Date("2026-09-27T18:00:00Z"))).toEqual({ windowStart: "2026-09-21", rows: [] });
    expect(calls.queried).toBeUndefined();
  });

  it("maps usage to accounts, sorted by cost desc", async () => {
    const { db } = fake([acct("L1", "paused"), acct("L2", "churned"), acct("L3", "inactive")], [
      { scopeKey: "L1", cost: "1.500000", lastAt: new Date("2026-09-25T10:00:00Z"), charges: BigInt(3) },
      { scopeKey: "L2", cost: "9.250000", lastAt: new Date("2026-09-26T10:00:00Z"), charges: BigInt(40) },
    ]);
    const r = await getInactiveUsage(db, new Date("2026-09-27T18:00:00Z"));
    expect(r.rows.map((x) => [x.locationId, x.billingState, x.cost, x.charges])).toEqual([["L2", "churned", "9.250000", 40], ["L1", "paused", "1.500000", 3]]);
    expect(r.rows[0].locationName).toBe("N-L2");
  });
});
