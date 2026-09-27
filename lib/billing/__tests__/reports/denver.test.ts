import { describe, expect, it } from "vitest";
import { addMonths, denverDayOf, denverMonthOf, denverMonthStart, monthRangeBounds, monthsBetween, sqlDenverMonth } from "../../reports/denver";
import { add, cmp, fmtMoney, isNeg, neg, pctOf, sub, sumOf } from "../../reports/money";

describe("Denver month bucketing", () => {
  it("uses the Denver calendar month, not UTC", () => {
    expect(denverMonthOf(new Date("2026-09-01T05:59:59.999Z"))).toBe("2026-08"); // 23:59 MDT Aug 31
    expect(denverMonthOf(new Date("2026-09-01T06:00:00.000Z"))).toBe("2026-09"); // 00:00 MDT Sep 1
    expect(denverMonthOf(new Date("2026-08-01T05:00:00.000Z"))).toBe("2026-07"); // 23:00 MDT Jul 31
    expect(denverDayOf(new Date("2026-09-27T03:00:00Z"))).toBe("2026-09-26");
  });
  it("handles standard time (MST, UTC-7) and the year boundary", () => {
    expect(denverMonthOf(new Date("2027-01-01T06:59:59Z"))).toBe("2026-12");
    expect(denverMonthOf(new Date("2027-01-01T07:00:00Z"))).toBe("2027-01");
  });
  it("month start instants respect DST", () => {
    expect(denverMonthStart("2026-09").toISOString()).toBe("2026-09-01T06:00:00.000Z"); // MDT
    expect(denverMonthStart("2026-12").toISOString()).toBe("2026-12-01T07:00:00.000Z"); // MST
    expect(denverMonthStart("2026-03").toISOString()).toBe("2026-03-01T07:00:00.000Z"); // still MST (DST starts Mar 8)
    expect(denverMonthStart("2026-04").toISOString()).toBe("2026-04-01T06:00:00.000Z");
  });
  it("month range bounds are half-open and contiguous", () => {
    const b = monthRangeBounds("2026-06", "2026-09");
    expect(b.from.toISOString()).toBe("2026-06-01T06:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(monthRangeBounds("2026-08", "2026-08").to.getTime()).toBe(monthRangeBounds("2026-09", "2026-09").from.getTime());
  });
  it("addMonths / monthsBetween cross years", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
  it("SQL fragment converts UTC-stored timestamps to a Denver month", () => {
    expect(sqlDenverMonth('"occurredAt"')).toBe(`to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver', 'YYYY-MM')`);
  });
});

describe("money helpers are exact decimals", () => {
  it("does not drift like floats", () => {
    expect(sumOf(Array(10).fill("0.1"))).toBe("1.000000");
    expect(add("0.1", "0.2")).toBe("0.300000");
    expect(sub("57", "57")).toBe("0.000000");
    expect(neg("-888.483003")).toBe("888.483003");
    expect(sumOf(["-0.000675", "-0.0079", "10"])).toBe("9.991425");
  });
  it("compares, signs and percentages", () => {
    expect(cmp("1.000001", "1")).toBe(1);
    expect(isNeg("-0.000001")).toBe(true);
    expect(isNeg("0.000000")).toBe(false);
    expect(pctOf("1000", "2.9")).toBe("29.000000");
  });
  it("formats for display", () => {
    expect(fmtMoney("1234567.891")).toBe("$1,234,567.89");
    expect(fmtMoney("-888.483003")).toBe("-$888.48");
    expect(fmtMoney("0.005")).toBe("$0.01");
    expect(fmtMoney("-0.001")).toBe("$0.00");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney("57", 0)).toBe("$57");
  });
});
