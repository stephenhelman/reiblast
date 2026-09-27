import { describe, expect, it } from "vitest";
import { Prisma, type BillingClass } from "@prisma/client";
import { addOneMonth, lastCorePayments, loadMembers, matchesState, rechargesSince, revenueVsUsage, sortMembers, withEstimates, type MemberFacts, type MemberRow } from "../../reports/members";
import type { LedgerRow } from "../../reports/revenue";

let n = 0;
const row = (at: string, cls: BillingClass, amount: string, o: Partial<LedgerRow> = {}): LedgerRow => ({
  ghlTransactionId: `k${++n}`, occurredAt: new Date(at), classification: cls, status: "succeeded", amount, amountRefunded: "0.000000", provider: "authorize-net", ghlAccountId: "A", refundDetectedAt: null, subscriptionId: null, classifierVersion: 2, ...o,
});
const facts = (o: Partial<MemberFacts> = {}): MemberFacts => ({
  accountId: "A", locationId: "LA", locationName: "Acme", businessName: null, billingState: "active", pauseReason: null, legacyUnreconciled: false, strikes: 0, trialOffer: null, trialEndsAt: null,
  coveredUntil: null, coverageNote: null, balance: null, lastCorePaymentAt: null, usage30: "0.000000", recharges30: "0.000000", ...o,
});

describe("expected next charge (≈) and the coverage override", () => {
  it("adds one calendar month, clamping the day", () => {
    expect(addOneMonth(new Date("2026-08-21T15:30:00Z")).toISOString()).toBe("2026-09-21T15:30:00.000Z");
    expect(addOneMonth(new Date("2026-01-31T10:00:00Z")).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addOneMonth(new Date("2028-01-31T10:00:00Z")).toISOString()).toBe("2028-02-29T10:00:00.000Z"); // leap year
    expect(addOneMonth(new Date("2026-12-15T10:00:00Z")).toISOString()).toBe("2027-01-15T10:00:00.000Z");
  });
  it("estimate = latest succeeded core payment + 1 month; none without a payment", () => {
    expect(withEstimates(facts({ lastCorePaymentAt: new Date("2026-08-21T12:00:00Z") })).expectedNextCharge?.toISOString()).toBe("2026-09-21T12:00:00.000Z");
    expect(withEstimates(facts()).expectedNextCharge).toBeNull();
  });
  it("the override applies when coveredUntil is later than the estimate — or when there is no estimate", () => {
    const last = new Date("2026-08-21T12:00:00Z");
    expect(withEstimates(facts({ lastCorePaymentAt: last, coveredUntil: new Date("2026-10-15T00:00:00Z") })).coverageOverrideApplies).toBe(true);
    expect(withEstimates(facts({ lastCorePaymentAt: last, coveredUntil: new Date("2026-09-10T00:00:00Z") })).coverageOverrideApplies).toBe(false);
    expect(withEstimates(facts({ lastCorePaymentAt: last, coveredUntil: null })).coverageOverrideApplies).toBe(false);
    expect(withEstimates(facts({ coveredUntil: new Date("2026-10-15T00:00:00Z") })).coverageOverrideApplies).toBe(true);
  });
});

describe("ledger-derived member facts", () => {
  const ledger = [
    row("2026-06-09T12:00:00Z", "core_subscription", "57"),
    row("2026-08-21T12:00:00Z", "core_subscription", "57"),
    row("2026-09-21T12:00:00Z", "core_subscription", "57", { status: "failed" }), // failed: never the "last payment"
    row("2026-08-30T12:00:00Z", "core_subscription", "57", { ghlAccountId: "B" }),
    row("2026-09-10T12:00:00Z", "wallet_auto_recharge", "10"),
    row("2026-09-12T12:00:00Z", "wallet_manual_recharge", "100", { amountRefunded: "25" }),
    row("2026-09-13T12:00:00Z", "wallet_auto_recharge", "10", { status: "failed" }),
    row("2026-08-01T12:00:00Z", "wallet_auto_recharge", "999"), // before the window
  ];
  it("last core payment = latest SUCCEEDED core_subscription per account", () => {
    const m = lastCorePayments(ledger);
    expect(m.get("A")?.toISOString()).toBe("2026-08-21T12:00:00.000Z");
    expect(m.get("B")?.toISOString()).toBe("2026-08-30T12:00:00.000Z");
  });
  it("30-day recharges = net succeeded auto + manual within the window only", () => {
    expect(rechargesSince(ledger, new Date("2026-08-28T00:00:00Z")).get("A")).toBe("85.000000");
    expect(rechargesSince(ledger, new Date("2026-08-28T00:00:00Z")).get("B")).toBeUndefined();
  });
  it("revenue vs usage by month (revenue rule) with net", () => {
    const usage = new Map([["2026-08", "30"], ["2026-09", "200"]]);
    const c = revenueVsUsage(ledger.filter((r) => r.ghlAccountId === "A"), usage, "2026-08", "2026-09");
    expect(c).toEqual([
      { month: "2026-08", revenue: "1056.000000", usage: "30", net: "1026.000000" }, // 57 + 999 (the Aug 1 recharge) 
      { month: "2026-09", revenue: "85.000000", usage: "200", net: "-115.000000" },
    ]);
  });
});

describe("filters and sorting", () => {
  const rows: MemberRow[] = [
    withEstimates(facts({ accountId: "A", billingState: "active", usage30: "50", strikes: 2, balance: { status: "ok", balance: "10", takenOn: "2026-09-26" } })),
    withEstimates(facts({ accountId: "B", billingState: null, usage30: "5", locationName: "Zeta", balance: null })),
    withEstimates(facts({ accountId: "C", billingState: "paused", usage30: "500", locationName: "Beta", balance: { status: "ok", balance: "-3", takenOn: "2026-09-26" }, lastCorePaymentAt: new Date("2026-08-01T00:00:00Z") })),
  ];
  const label = (r: MemberRow) => r.locationName ?? "";
  it("state filter includes 'not seeded' (null) and 'all'", () => {
    expect(rows.filter((r) => matchesState(r, "all")).length).toBe(3);
    expect(rows.filter((r) => matchesState(r, "not_seeded")).map((r) => r.accountId)).toEqual(["B"]);
    expect(rows.filter((r) => matchesState(r, "paused")).map((r) => r.accountId)).toEqual(["C"]);
  });
  it("sorts by usage, balance (unknown last when desc→asc), strikes, last payment, label", () => {
    expect(sortMembers(rows, "usage30", "desc", label).map((r) => r.accountId)).toEqual(["C", "A", "B"]);
    expect(sortMembers(rows, "balance", "asc", label).map((r) => r.accountId)).toEqual(["B", "C", "A"]);
    expect(sortMembers(rows, "strikes", "desc", label)[0].accountId).toBe("A");
    expect(sortMembers(rows, "lastCore", "desc", label)[0].accountId).toBe("C");
    expect(sortMembers(rows, "label", "asc", label).map((r) => r.accountId)).toEqual(["A", "C", "B"]);
  });
});

describe("loadMembers reads the coverage override from the typed columns", () => {
  const account = (id: string, o: Record<string, unknown> = {}) => ({ id, locationId: `LOC_${id}`, locationName: id, billingState: "active", pauseReason: null, legacyUnreconciled: false, trialOffer: null, trialEndsAt: null, coreCoveredUntil: null, coreCoverageNote: null, user: { businessName: null, warningCount: 0 }, ...o });
  const ledgerRow = (acct: string, at: string) => ({ ghlTransactionId: `L${acct}`, occurredAt: new Date(at), classification: "core_subscription", status: "succeeded", amount: new Prisma.Decimal("57"), amountRefunded: new Prisma.Decimal("0"), provider: "authorize-net", ghlAccountId: acct, refundDetectedAt: null, subscriptionId: null, classifierVersion: 2 });

  it("maps coreCoveredUntil / coreCoverageNote onto the row and computes the override badge against the estimate", async () => {
    const selects: Record<string, unknown>[] = [];
    const db: any = {
      ghlAccount: { findMany: async ({ select }: { select: Record<string, unknown> }) => (selects.push(select), [
        account("A", { coreCoveredUntil: new Date("2026-11-21T07:00:00.000Z"), coreCoverageNote: "Prepaid during processor migration" }),
        account("B", { coreCoveredUntil: new Date("2026-09-10T06:00:00.000Z") }),
        account("C"),
      ]) },
      billingLedgerEntry: { findMany: async () => [ledgerRow("A", "2026-08-21T12:00:00Z"), ledgerRow("B", "2026-08-21T12:00:00Z")] },
      $queryRaw: async () => [],
    };
    const { rows } = await loadMembers(db, "HQ", new Date("2026-09-27T12:00:00Z"));
    expect(selects[0]).toMatchObject({ coreCoveredUntil: true, coreCoverageNote: true }); // typed fields are selected, no raw lookup
    const by = Object.fromEntries(rows.map((r) => [r.accountId, r]));
    expect(by.A.coveredUntil?.toISOString()).toBe("2026-11-21T07:00:00.000Z");
    expect(by.A.coverageNote).toBe("Prepaid during processor migration");
    expect(by.A.expectedNextCharge?.toISOString()).toBe("2026-09-21T12:00:00.000Z");
    expect(by.A.coverageOverrideApplies).toBe(true); // Nov 21 is later than the ≈ Sep 21 estimate
    expect(by.B.coverageOverrideApplies).toBe(false); // Sep 10 is earlier than the estimate
    expect(by.C).toMatchObject({ coveredUntil: null, coverageNote: null, coverageOverrideApplies: false });
  });
});
