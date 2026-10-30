import { describe, expect, it } from "vitest";
import { parseCents, parseFixedCost, parseKurvStatement, parsePayment, parseRate, parseReserveMovement } from "../statementForms";

const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });

describe("parseCents", () => {
  it("parses dollars to integer cents", () => {
    expect(parseCents("12")).toBe(1200);
    expect(parseCents("$1,234.5")).toBe(123450);
    expect(parseCents("0.07")).toBe(7);
    expect(parseCents("-3.25", { signed: true })).toBe(-325);
  });
  it("rejects junk, 3 decimals, and negatives unless signed", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1,23", "1e3", "12.", ".5"]) expect(parseCents(bad), bad).toBeNull();
  });
});

describe("forms", () => {
  it("payment: needs a real date and a positive amount", () => {
    expect(parsePayment(form({ date: "2026-11-03", amount: "1,000.50", note: " check " }))).toEqual({ ok: true, value: { date: "2026-11-03", amountCents: 100050, note: "check" } });
    expect(parsePayment(form({ date: "2026-02-30", amount: "5" })).ok).toBe(false);
    expect(parsePayment(form({ date: "2026-11-03", amount: "0" })).ok).toBe(false);
  });

  it("kurv statement: month >= 2026-10, fees + reserve can't exceed sales", () => {
    const base = { month: "2026-10", salesCount: "300", salesAmount: "7000", dailyFeesPaid: "300", reserveFunded: "700", reserveReleased: "0", monthlyDebit: "230" };
    expect(parseKurvStatement(form(base))).toMatchObject({ ok: true, value: { salesCount: 300, salesAmountCents: 700000, monthlyDebitCents: 23000 } });
    expect(parseKurvStatement(form({ ...base, month: "2026-09" })).ok).toBe(false);
    expect(parseKurvStatement(form({ ...base, dailyFeesPaid: "6500", reserveFunded: "700" })).ok).toBe(false);
    expect(parseKurvStatement(form({ ...base, salesCount: "3.5" })).ok).toBe(false);
  });

  it("reserve movement: sign rules and required notes", () => {
    expect(parseReserveMovement(form({ date: "2026-11-02", kind: "release", amount: "250" })).ok).toBe(true);
    expect(parseReserveMovement(form({ date: "2026-11-02", kind: "withdrawal", amount: "250" })).ok).toBe(false); // needs a note
    expect(parseReserveMovement(form({ date: "2026-11-02", kind: "withdrawal", amount: "-250", note: "x" })).ok).toBe(false);
    expect(parseReserveMovement(form({ date: "2026-11-02", kind: "adjustment", amount: "-25", note: "fix" }))).toMatchObject({ ok: true, value: { amountCents: -2500 } });
    expect(parseReserveMovement(form({ date: "2026-11-02", kind: "adjustment", amount: "0", note: "fix" })).ok).toBe(false);
  });

  it("rate: known key, 1st of month, fractions only for rates", () => {
    expect(parseRate(form({ key: "kurv_discount_rate", value: "0.03", effectiveFrom: "2027-01-01" })).ok).toBe(true);
    expect(parseRate(form({ key: "kurv_discount_rate", value: "0.03", effectiveFrom: "2027-01-15" })).ok).toBe(false);
    expect(parseRate(form({ key: "nope", value: "1", effectiveFrom: "2027-01-01" })).ok).toBe(false);
    expect(parseRate(form({ key: "kurv_discount_rate", value: "2.9", effectiveFrom: "2027-01-01" })).ok).toBe(false);
    expect(parseRate(form({ key: "kurv_fixed_monthly", value: "50", effectiveFrom: "2027-01-01" })).ok).toBe(true);
  });

  it("fixed cost: snake_case name, 1st of month, 0 allowed", () => {
    expect(parseFixedCost(form({ name: "ghl_agency_plan", amount: "0", effectiveFrom: "2027-01-01" }))).toMatchObject({ ok: true, value: { monthlyAmountCents: 0 } });
    expect(parseFixedCost(form({ name: "Bad Name", amount: "5", effectiveFrom: "2027-01-01" })).ok).toBe(false);
    expect(parseFixedCost(form({ name: "x_y", amount: "5", effectiveFrom: "2027-01-02" })).ok).toBe(false);
  });
});
