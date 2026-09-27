import { describe, expect, it } from "vitest";
import type { BillingClass } from "@prisma/client";
import { buildAgencyMargin, buildMemberMargin, parseFeePct, sortMemberMargin } from "../../reports/margin";
import { aggregateRevenue, revenueDetail, type LedgerRow } from "../../reports/revenue";
import { sumOf } from "../../reports/money";

let n = 0;
const row = (at: string, cls: BillingClass, amount: string, o: Partial<LedgerRow> = {}): LedgerRow => ({
  ghlTransactionId: `m${++n}`, occurredAt: new Date(at), classification: cls, status: "succeeded", amount, amountRefunded: "0.000000", provider: "authorize-net", ghlAccountId: "A", refundDetectedAt: null, subscriptionId: null, classifierVersion: 2, ...o,
});
const G = (agency_cash: string, tax: string) => ({ one_time: "0.000000", ongoing: "0.000000", agency_cash, tax });

describe("agency gross cash margin", () => {
  const revenue = aggregateRevenue(
    [row("2026-08-10T12:00:00Z", "core_subscription", "1000"), row("2026-08-11T12:00:00Z", "wallet_auto_recharge", "500.5"), row("2026-09-10T12:00:00Z", "core_subscription", "200")],
    "2026-08", "2026-09",
  ).rows;
  const costs = [{ month: "2026-08", byGroup: G("961.196233", "55.04") }] as never;

  it("margin = net revenue − agency cash − wallet sales tax, by Denver month", () => {
    const m = buildAgencyMargin(revenue, costs, null);
    expect(m.rows[0]).toMatchObject({ month: "2026-08", netRevenue: "1500.500000", agencyCash: "961.196233", tax: "55.040000", margin: "484.263767", feeEstimate: null });
    // a month with no cost rows still appears; costs default to zero
    expect(m.rows[1]).toMatchObject({ month: "2026-09", netRevenue: "200.000000", agencyCash: "0.000000", tax: "0.000000", margin: "200.000000" });
    expect(m.totals.margin).toBe("684.263767");
    expect(m.totals.feeEstimate).toBeNull();
  });
  it("the margin can be negative", () => {
    expect(buildAgencyMargin([{ month: "2026-08", net: "100" } as never], [{ month: "2026-08", byGroup: G("150", "5") }] as never, null).rows[0].margin).toBe("-55.000000");
  });
  it("the fee line exists only when a valid percentage is configured, and is separate from the margin", () => {
    const m = buildAgencyMargin(revenue, costs, "2.9");
    expect(m.rows[0].feeEstimate).toBe("43.514500"); // 2.9% of 1500.50
    expect(m.rows[0].margin).toBe("484.263767"); // gross margin unchanged
    expect(m.rows[0].marginAfterFeeEstimate).toBe("440.749267");
    expect(parseFeePct("2.9")).toBe("2.9");
    for (const bad of [undefined, "", "abc", "0", "100", "-1", "2.9%", "1e2"]) expect(parseFeePct(bad)).toBeNull();
  });
});

describe("per-member margin", () => {
  const members = [{ accountId: "A", locationId: "LA" }, { accountId: "B", locationId: "LB" }, { accountId: "C", locationId: "LC" }, { accountId: "D", locationId: null }];
  const ledger = [
    row("2026-08-01T12:00:00Z", "wallet_auto_recharge", "100", { ghlAccountId: "A" }),
    row("2026-08-02T12:00:00Z", "wallet_manual_recharge", "50", { ghlAccountId: "A", amountRefunded: "10" }),
    row("2026-08-03T12:00:00Z", "core_subscription", "57", { ghlAccountId: "A" }),
    row("2026-08-04T12:00:00Z", "core_subscription", "57", { ghlAccountId: "B" }),
    row("2026-08-05T12:00:00Z", "wallet_auto_recharge", "20", { ghlAccountId: null }), // unmatched
    row("2026-08-06T12:00:00Z", "core_subscription", "57", { ghlAccountId: "OWNER" }), // not a listed member
    row("2026-08-07T12:00:00Z", "core_subscription", "57", { ghlAccountId: "A", status: "failed" }), // not revenue
    row("2026-07-07T12:00:00Z", "core_subscription", "57", { ghlAccountId: "A" }), // outside range
    row("2026-08-08T12:00:00Z", "unclassified", "5", { ghlAccountId: "B" }),
  ];
  const usage = new Map([["LA", { cost: "120.5", count: 40 }], ["LC", { cost: "9", count: 3 }]]);
  const m = buildMemberMargin(members, ledger, usage, { fromMonth: "2026-08", toMonth: "2026-08" });

  it("recharges + core (net of refunds) collected vs usage charged; net = collected − usage", () => {
    const a = m.rows.find((r) => r.accountId === "A")!;
    expect(a).toMatchObject({ recharges: "140.000000", core: "57.000000", other: "0.000000", collected: "197.000000", usage: "120.500000", usageCount: 40, net: "76.500000", ledgerRows: 3 });
    const b = m.rows.find((r) => r.accountId === "B")!;
    expect(b).toMatchObject({ core: "57.000000", other: "5.000000", collected: "62.000000", usage: "0.000000", net: "62.000000" });
  });
  it("usage with no revenue is still listed (a member who costs money and pays nothing)", () => {
    expect(m.rows.find((r) => r.accountId === "C")).toMatchObject({ collected: "0.000000", usage: "9.000000", net: "-9.000000" });
  });
  it("members with no activity in range are omitted", () => expect(m.rows.some((r) => r.accountId === "D")).toBe(false));
  it("ledger rows with no account form the Unmatched line", () => {
    expect(m.unmatched).toMatchObject({ recharges: "20.000000", collected: "20.000000", ledgerRows: 1 });
  });
  it("totals reconcile with the revenue rule: collected total + unlisted-account revenue == total net revenue for the range", () => {
    const rangeRevenue = sumOf(revenueDetail(ledger, { fromMonth: "2026-08", toMonth: "2026-08" }).map((r) => r.net));
    expect(sumOf([m.totals.collected, m.unlistedRevenue])).toBe(rangeRevenue);
    expect(m.unlistedRevenue).toBe("57.000000"); // the OWNER row is surfaced, not silently dropped
  });
  it("sorts by any column, ties broken by account id", () => {
    const label = (r: { accountId: string }) => r.accountId;
    expect(sortMemberMargin(m.rows, "net", "desc", label).map((r) => r.accountId)).toEqual(["A", "B", "C"]);
    expect(sortMemberMargin(m.rows, "net", "asc", label).map((r) => r.accountId)).toEqual(["C", "B", "A"]);
    expect(sortMemberMargin(m.rows, "usage", "desc", label).map((r) => r.accountId)[0]).toBe("A");
    expect(sortMemberMargin(m.rows, "label", "asc", label).map((r) => r.accountId)).toEqual(["A", "B", "C"]);
  });
});
