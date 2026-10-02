import { describe, expect, it } from "vitest";
import { accToRows, addToAcc, daysInWindow, microsToDecimalString, previousUtcWindow, toMicros, unfilteredScope, type Acc } from "../usageRollup";

const row = (id: string, description: string, amount: number, settlementTime = "2026-08-01T10:00:00.000Z") => ({ id, description, amount, settlementTime });

describe("usage rollup math", () => {
  it("buckets by UTC day and category, summing exactly in micros", () => {
    const acc: Acc = {};
    addToAcc(acc, row("1", "Outbound SMS: Ref-a", -0.0079));
    addToAcc(acc, row("2", "Outbound SMS: Ref-b", -0.0079));
    addToAcc(acc, row("3", "Outbound SMS: Ref-c", -0.000675, "2026-08-02T00:00:01.000Z"));
    addToAcc(acc, row("4", "Auto-Recharge for Agency - X of USD 10 was successfully added", 10));
    const rows = accToRows(acc).sort((a, b) => (a.day + a.category).localeCompare(b.day + b.category));
    expect(rows).toEqual([
      { day: "2026-08-01", category: "agency_auto_recharge", count: 1, micros: 10_000_000 },
      { day: "2026-08-01", category: "outbound_sms", count: 2, micros: -15_800 },
      { day: "2026-08-02", category: "outbound_sms", count: 1, micros: -675 },
    ]);
  });

  it("does not drift on classic float sums", () => {
    const acc: Acc = {};
    for (let i = 0; i < 10; i++) addToAcc(acc, row(String(i), "Outbound SMS: x", -0.1));
    expect(accToRows(acc)[0].micros).toBe(-1_000_000);
  });

  it("unknown descriptions land in other", () => {
    const acc: Acc = {};
    addToAcc(acc, row("1", "Totally new thing", -1));
    expect(accToRows(acc)[0].category).toBe("other");
  });

  it("formats micros as an exact decimal string", () => {
    expect(microsToDecimalString(-888_483_003)).toBe("-888.483003");
    expect(microsToDecimalString(961_196_233)).toBe("961.196233");
    expect(microsToDecimalString(-675)).toBe("-0.000675");
    expect(microsToDecimalString(0)).toBe("0.000000");
    expect(toMicros(-0.000675)).toBe(-675);
  });

  it("unfiltered scope: blank or '-' name is agency, a real name is unattributed", () => {
    expect(unfilteredScope("-")).toBe("_agency");
    expect(unfilteredScope("")).toBe("_agency");
    expect(unfilteredScope(null)).toBe("_agency");
    expect(unfilteredScope("Some Business")).toBe("_unattributed");
  });

  it("lists inclusive UTC days and the previous two complete days", () => {
    expect(daysInWindow("2026-08-30T00:00:00.000Z", "2026-09-02T23:59:59.999Z")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(previousUtcWindow(new Date("2026-09-26T03:00:00Z"))).toEqual({ from: "2026-09-24T00:00:00.000Z", to: "2026-09-25T23:59:59.999Z" });
  });
});
