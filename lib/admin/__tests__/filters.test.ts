import { describe, expect, it } from "vitest";
import { definedOnly, paramsOf, parseCostFilters, parseCursor, parseMarginSort, parseMemberFilters, parseRange, parseRevenueFilters } from "../filters";
import { adminHref, exportHref, qs } from "../links";

const NOW = new Date("2026-09-27T18:00:00Z"); // Denver: 2026-09
const p = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe("parseRange", () => {
  it("defaults to the last 6 Denver months ending now, never before the first data month", () => {
    expect(parseRange(p({}), NOW)).toEqual({ fromMonth: "2026-06", toMonth: "2026-09" }); // 6 months back = 2026-04, clamped to data start
    expect(parseRange(p({}), new Date("2027-03-15T12:00:00Z"))).toEqual({ fromMonth: "2026-10", toMonth: "2027-03" });
  });
  it("honors valid from/to, rejects malformed months, clamps the future, swaps impossible ranges", () => {
    expect(parseRange(p({ from: "2026-07", to: "2026-08" }), NOW)).toEqual({ fromMonth: "2026-07", toMonth: "2026-08" });
    expect(parseRange(p({ from: "2026-13", to: "garbage" }), NOW).toMonth).toBe("2026-09");
    expect(parseRange(p({ to: "2030-01" }), NOW).toMonth).toBe("2026-09");
    expect(parseRange(p({ from: "2026-09", to: "2026-07" }), NOW)).toEqual({ fromMonth: "2026-07", toMonth: "2026-07" });
    expect(parseRange(p({ from: "2020-01" }), NOW).fromMonth).toBe("2026-06");
  });
});

describe("filters are validated and shared between pages and exports", () => {
  it("revenue: class, provider, account, month", () => {
    const f = parseRevenueFilters(p({ from: "2026-06", to: "2026-09", month: "2026-08", class: "core_subscription", provider: "stripe", account: "unmatched" }), NOW);
    expect(f).toMatchObject({ month: "2026-08", klass: "core_subscription", provider: "stripe", accountId: "unmatched" });
    const bad = parseRevenueFilters(p({ month: "08", class: "nope", provider: "a b;drop", account: "x'y" }), NOW);
    expect(bad).toMatchObject({ month: undefined, klass: undefined, provider: undefined, accountId: undefined });
  });
  it("costs: scope, group, category, scopeKey", () => {
    expect(parseCostFilters(p({ scope: "hq", group: "one_time", category: "a2p_registration", scopeKey: "LOC_1", month: "2026-08" }), NOW)).toMatchObject({ scope: "hq", group: "one_time", category: "a2p_registration", scopeKey: "LOC_1", month: "2026-08" });
    expect(parseCostFilters(p({ scope: "x", group: "y", category: "A B", scopeKey: "a/b" }), NOW)).toMatchObject({ scope: undefined, group: undefined, category: undefined, scopeKey: undefined });
  });
  it("members and margin sorting fall back to safe defaults", () => {
    expect(parseMemberFilters(p({ state: "paused", sort: "usage30", dir: "desc" }))).toEqual({ state: "paused", sort: "usage30", dir: "desc" });
    expect(parseMemberFilters(p({ state: "bogus", sort: "bogus", dir: "sideways" }))).toEqual({ state: "all", sort: "label", dir: "asc" });
    expect(parseMarginSort(p({}))).toEqual({ sort: "net", dir: "desc" });
    expect(parseMemberFilters(p({ state: "not_seeded" })).state).toBe("not_seeded");
  });
  it("cursor and Next searchParams adapter", () => {
    expect(parseCursor(p({ after: "abc_-123" }))).toBe("abc_-123");
    expect(parseCursor(p({ after: "a b" }))).toBeNull();
    expect(paramsOf({ a: ["1", "2"], b: undefined, c: "x" }).get("a")).toBe("1");
    expect(paramsOf({ b: undefined }).get("b")).toBeNull();
    expect(definedOnly({ a: "1", b: undefined, c: "", d: null, e: 0 })).toEqual({ a: "1", e: "0" });
  });
});

describe("links respect the admin base path", () => {
  it("qs drops empty values and encodes the rest", () => {
    expect(qs({ a: "x y", b: undefined, c: "", d: 0, e: false, f: null })).toBe("?a=x%20y&d=0");
    expect(qs({})).toBe("");
  });
  it("admin host (base '') vs preview path mode (base '/admin')", () => {
    expect(adminHref("", "/revenue/rows", { month: "2026-08" })).toBe("/revenue/rows?month=2026-08");
    expect(adminHref("/admin", "/revenue/rows", { month: "2026-08" })).toBe("/admin/revenue/rows?month=2026-08");
    expect(adminHref("", "/")).toBe("/");
    expect(adminHref("/admin", "/")).toBe("/admin");
  });
  it("export links are never under the admin base", () => expect(exportHref("costs", { detail: 1, month: "2026-08" })).toBe("/api/admin/export/costs?detail=1&month=2026-08"));
});
