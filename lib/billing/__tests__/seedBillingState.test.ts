import { describe, expect, it, vi } from "vitest";
import { BillingState, PauseReason } from "@prisma/client";
import { classifyLegacySubscription, loadRechargeActivity, loadSubscriptionsFromState, orderSubscriptions, resolveActivity, trailingActivityWindowStart } from "../seedBillingState";
import { denverDayOf } from "../reports/denver";

describe("trailingActivityWindowStart", () => {
  it("is ~30 days before now, snapped to a Denver-day boundary", () => {
    const now = new Date("2026-09-27T15:00:00Z");
    const start = trailingActivityWindowStart(now);
    expect(denverDayOf(start)).toBe(denverDayOf(new Date(now.getTime() - 30 * 86_400_000)));
    // A Denver-day start is local midnight, so re-flooring it is a no-op.
    expect(denverDayOf(start) === denverDayOf(new Date(start.getTime() + 1000))).toBe(true);
  });

  it("respects a custom day count", () => {
    const now = new Date("2026-09-27T15:00:00Z");
    expect(trailingActivityWindowStart(now, 7).getTime()).toBeGreaterThan(trailingActivityWindowStart(now, 30).getTime());
  });
});

describe("classifyLegacySubscription", () => {
  it("null (unknown) → null: caller falls back or lists it, never guesses", () => {
    expect(classifyLegacySubscription(null)).toBeNull();
  });

  it("true (recent activity) → paused/non_payment, legacyUnreconciled", () => {
    expect(classifyLegacySubscription(true)).toMatchObject({ billingState: BillingState.paused, pauseReason: PauseReason.non_payment, legacyUnreconciled: true });
  });

  it("false (no recent activity) → churned, no pause reason, legacyUnreconciled", () => {
    expect(classifyLegacySubscription(false)).toMatchObject({ billingState: BillingState.churned, pauseReason: null, legacyUnreconciled: true });
  });
});

describe("GhlSubscriptionState source", () => {
  const db = (rows: unknown[]) => ({ ghlSubscriptionState: { findMany: vi.fn().mockResolvedValue(rows) } }) as never;

  it("maps rows into the seed's subscription shape (name → entitySourceName, trialEndsAt → trialEndDate)", async () => {
    const subs = await loadSubscriptionsFromState(db([
      { subscriptionId: "s1", contactId: "c1", status: "trialing", name: "14 Day Trial", trialEndsAt: new Date("2026-10-05T00:00:00Z") },
      { subscriptionId: "s2", contactId: "c2", status: "active", name: null, trialEndsAt: null },
    ]));
    expect(subs).toEqual([
      { contactId: "c1", status: "trialing", entitySourceName: "14 Day Trial", trialEndDate: "2026-10-05T00:00:00.000Z" },
      { contactId: "c2", status: "active", entitySourceName: undefined, trialEndDate: undefined },
    ]);
  });

  it("ranks a contact's subscriptions by liveness when there is no createdAt", () => {
    const ordered = orderSubscriptions([{ status: "canceled" }, { status: "trialing" }, { status: "active" }, { status: "expired" }]);
    expect(ordered.map((s) => s.status)).toEqual(["active", "trialing", "expired", "canceled"]);
  });

  it("still orders newest-first by createdAt for the pull JSON", () => {
    const ordered = orderSubscriptions([{ status: "active", createdAt: "2026-01-01" }, { status: "canceled", createdAt: "2026-06-01" }]);
    expect(ordered[0].status).toBe("canceled");
  });
});

describe("ledger-based recent-activity check", () => {
  const windowStart = new Date("2026-09-01T06:00:00Z");
  const ledgerDb = (recent: unknown[], any: unknown) => {
    const findMany = vi.fn().mockResolvedValue(recent);
    const findFirst = vi.fn().mockResolvedValue(any);
    return { db: { billingLedgerEntry: { findMany, findFirst } } as never, findMany };
  };

  it("queries only succeeded auto/manual wallet recharges inside the window", async () => {
    const { db, findMany } = ledgerDb([], { id: "x" });
    await loadRechargeActivity(db, windowStart);
    expect(findMany).toHaveBeenCalledWith({
      where: { classification: { in: ["wallet_auto_recharge", "wallet_manual_recharge"] }, status: "succeeded", occurredAt: { gte: windowStart } },
      select: { ghlAccountId: true, contactId: true },
    });
  });

  it("collects account and contact ids; flags whether the ledger has any recharges", async () => {
    const { db } = ledgerDb([{ ghlAccountId: "a1", contactId: "c1" }, { ghlAccountId: null, contactId: "c2" }], { id: "x" });
    const r = await loadRechargeActivity(db, windowStart);
    expect([...r.accountIds]).toEqual(["a1"]);
    expect([...r.contactIds].sort()).toEqual(["c1", "c2"]);
    expect(r.ledgerHasRecharges).toBe(true);
    expect((await loadRechargeActivity(ledgerDb([], null).db, windowStart)).ledgerHasRecharges).toBe(false);
  });

  const ledger = { accountIds: new Set(["a1"]), contactIds: new Set(["c2"]), ledgerHasRecharges: true };
  const base = { walletHasAny: false, walletRecent: false, ledger, contactId: "cX", fallback: () => null };

  it("WalletTransaction wins when the location has data, even against the ledger", () => {
    expect(resolveActivity({ ...base, walletHasAny: true, walletRecent: false, accountId: "a1" })).toBe(false);
    expect(resolveActivity({ ...base, walletHasAny: true, walletRecent: true })).toBe(true);
  });

  it("with no WalletTransaction data, a recharge in the window (by account or contact) → active", () => {
    expect(resolveActivity({ ...base, accountId: "a1" })).toBe(true);
    expect(resolveActivity({ ...base, contactId: "c2" })).toBe(true);
  });

  it("with no WalletTransaction data and no recharge in the window → inactive (churned)", () => {
    expect(resolveActivity({ ...base, accountId: "a9" })).toBe(false);
    expect(classifyLegacySubscription(resolveActivity({ ...base, accountId: "a9" }))).toMatchObject({ billingState: BillingState.churned });
  });

  it("an empty ledger is unknown, not inactive: falls back, else null", () => {
    const empty = { accountIds: new Set<string>(), contactIds: new Set<string>(), ledgerHasRecharges: false };
    expect(resolveActivity({ ...base, ledger: empty })).toBeNull();
    expect(resolveActivity({ ...base, ledger: empty, fallback: () => true })).toBe(true);
  });
});
