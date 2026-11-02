import { describe, expect, it } from "vitest";
import { monthLabel, printWalletRows } from "../printModel";

const r = (category: string, cents: number, scope: "member" | "hq" = "member") => ({ category, scope, count: 1, cents });

describe("printWalletRows", () => {
  it("merges scopes per category, sorts desc, and folds anything under $5 into a last 'Other' row", () => {
    const out = printWalletRows([r("sms_outbound", 3000), r("sms_outbound", 2500, "hq"), r("email", 12000), r("a2p_fee", 499), r("phone_number", 100), r("ai_calls", 500)]);
    expect(out).toEqual([{ label: "email", cents: 12000 }, { label: "sms outbound", cents: 5500 }, { label: "ai calls", cents: 500 }, { label: "Other", cents: 599 }]);
  });
  it("has no Other row when nothing is small, and is empty for no usage", () => {
    expect(printWalletRows([r("email", 900)]).map((x) => x.label)).toEqual(["email"]);
    expect(printWalletRows([])).toEqual([]);
  });
});
describe("monthLabel", () => it("names the month", () => expect(monthLabel("2026-10")).toBe("October 2026")));
