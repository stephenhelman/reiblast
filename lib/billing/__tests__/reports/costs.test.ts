import { describe, expect, it } from "vitest";
import { AGENCY_CASH_CATEGORIES, costDisplay, costGroupOf, costWhere, ONE_TIME_CATEGORIES, requiresMonth, scopeClassOf, summarizeCosts, TAX_CATEGORIES, type CostCell } from "../../reports/costs";
import { parseCategoryGroups } from "./_helpers";

describe("cost groups", () => {
  it("one-time, agency cash and taxes are exactly the named categories; everything else is ongoing", () => {
    for (const c of ["a2p_registration", "a2p_fast_track", "domain_purchase", "caller_id_verification"]) expect(costGroupOf(c)).toBe("one_time");
    for (const c of ["agency_auto_recharge", "agency_manual_recharge"]) expect(costGroupOf(c)).toBe("agency_cash");
    expect(costGroupOf("wallet_sales_tax")).toBe("tax");
    for (const c of ["outbound_sms", "inbound_sms", "sms_carrier_fee", "phone_number_monthly", "email", "ask_ai", "workflow_premium", "email_verification", "other", "brand_new_category"]) expect(costGroupOf(c)).toBe("ongoing");
    expect(parseCategoryGroups()).toEqual({ oneTime: ONE_TIME_CATEGORIES.length, agency: AGENCY_CASH_CATEGORIES.length, tax: TAX_CATEGORIES.length });
  });
  it("scope class: members, HQ, _agency, _unattributed", () => {
    expect(scopeClassOf("LOC_M1", "LOC_HQ")).toBe("member");
    expect(scopeClassOf("LOC_HQ", "LOC_HQ")).toBe("hq");
    expect(scopeClassOf("_agency", "LOC_HQ")).toBe("agency");
    expect(scopeClassOf("_unattributed", "LOC_HQ")).toBe("unattributed");
    expect(scopeClassOf("LOC_HQ", null)).toBe("member"); // no HQ configured → nothing is HQ
  });
  it("display sign: charges shown positive, agency cash as stored (positive)", () => {
    expect(costDisplay("ongoing", "-888.483003")).toBe("888.483003");
    expect(costDisplay("tax", "-55.040000")).toBe("55.040000");
    expect(costDisplay("one_time", "-15.000000")).toBe("15.000000");
    expect(costDisplay("agency_cash", "961.196233")).toBe("961.196233");
  });
});

const cell = (month: string, scope: CostCell["scope"], category: string, stored: string, count = 1): CostCell => {
  const group = costGroupOf(category);
  return { month, scope, category, group, count, stored, display: costDisplay(group, stored) };
};

describe("summarizeCosts", () => {
  const cells = [
    cell("2026-08", "member", "outbound_sms", "-400"),
    cell("2026-08", "member", "a2p_registration", "-15"),
    cell("2026-08", "member", "sms_carrier_fee", "-473.483003"),
    cell("2026-08", "hq", "phone_number_monthly", "-12"),
    cell("2026-08", "agency", "agency_auto_recharge", "961.196233"),
    cell("2026-08", "agency", "wallet_sales_tax", "-55.04"),
    cell("2026-09", "member", "outbound_sms", "-10"),
    cell("2026-09", "unattributed", "email", "-0.002025"),
  ];
  const s = summarizeCosts(cells);
  it("groups by month and group; members/HQ/agency/unattributed stay separate", () => {
    const aug = s.byMonth.find((m) => m.month === "2026-08")!;
    expect(aug.byGroup).toEqual({ one_time: "15.000000", ongoing: "885.483003", agency_cash: "961.196233", tax: "55.040000" });
    expect(aug.byScope.member.ongoing).toBe("873.483003");
    expect(aug.byScope.hq.ongoing).toBe("12.000000");
    expect(aug.byScope.agency.agency_cash).toBe("961.196233");
    expect(s.byScope.unattributed.ongoing).toBe("0.002025");
  });
  it("totals equal the sum of the cells", () => {
    expect(s.totals.byGroup.ongoing).toBe("895.485028");
    expect(s.totals.count).toBe(8);
  });
});

describe("costWhere builds ONE filter for the aggregate and the detail", () => {
  const text = (f: Parameters<typeof costWhere>[0], hq: string | null = "LOC_HQ") => { const w = costWhere(f, hq); return { sql: w.sql, values: w.values }; };
  it("range → half-open UTC bounds of Denver months", () => {
    const w = text({ fromMonth: "2026-06", toMonth: "2026-09" });
    expect(w.values).toContain("2026-06-01T06:00:00.000Z");
    expect(w.values).toContain("2026-10-01T06:00:00.000Z");
  });
  it("a month narrows the range to that Denver month (DST-correct)", () => {
    const w = text({ fromMonth: "2026-06", toMonth: "2026-09", month: "2026-11" });
    expect(w.values).toContain("2026-11-01T06:00:00.000Z"); // still MDT on Nov 1 (DST ends Nov 1 at 02:00)
    expect(w.values).toContain("2026-12-01T07:00:00.000Z"); // MST
    expect(w.values).not.toContain("2026-06-01T06:00:00.000Z");
  });
  it("group filters use the category lists (ongoing = NOT IN all three)", () => {
    expect(text({ fromMonth: "2026-08", toMonth: "2026-08", group: "one_time" }).sql).toContain('"category" IN');
    expect(text({ fromMonth: "2026-08", toMonth: "2026-08", group: "one_time" }).values).toEqual(expect.arrayContaining([...ONE_TIME_CATEGORIES]));
    const ongoing = text({ fromMonth: "2026-08", toMonth: "2026-08", group: "ongoing" });
    expect(ongoing.sql).toContain('"category" NOT IN');
    expect(ongoing.values).toEqual(expect.arrayContaining([...ONE_TIME_CATEGORIES, ...AGENCY_CASH_CATEGORIES, ...TAX_CATEGORIES]));
  });
  it("scope, scopeKey and category add conditions; values are parameterized, never inlined", () => {
    const w = text({ fromMonth: "2026-08", toMonth: "2026-08", scope: "member", scopeKey: "LOC_M1", category: "outbound_sms" });
    expect(w.values).toEqual(expect.arrayContaining(["member", "LOC_M1", "outbound_sms"]));
    expect(w.sql).not.toContain("LOC_M1");
    expect(w.sql).not.toContain("outbound_sms");
  });
  it("raw-transaction views require a month", () => {
    expect(requiresMonth({})).toBe(true);
    expect(requiresMonth({ month: "2026-08" })).toBe(false);
  });
});
