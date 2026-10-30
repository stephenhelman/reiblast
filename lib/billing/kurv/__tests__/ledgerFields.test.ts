import { describe, expect, it } from "vitest";
import { listTxn } from "../../__tests__/fixtures";
import { normalizeTransaction } from "../../normalizeTransaction";
import { kurvFields } from "../ledgerFields";
import { KURV_RATE_KEYS, kurvRatesAsOf, rateAsOf } from "../rates";

const f = (o = {}) => kurvFields(normalizeTransaction(listTxn(o)));
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("kurvFields", () => {
  it("settled sale gets batch window, label and deposit date (Sep 30 5:16 PM → Oct 1 batch → deposits Oct 2)", () => {
    const r = f({ submitTimeUTC: "2026-10-01T00:16:28.213Z", settleAmount: 34.21 });
    expect(r.batchWindowStart?.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(day(r.batchDate)).toBe("2026-10-01");
    expect(day(r.expectedDepositDate)).toBe("2026-10-02");
    expect(r.settleAmountCents).toBe(3421);
  });

  it("Saturday sale: labeled Sunday, deposits Monday", () => {
    const r = f({ submitTimeUTC: "2026-09-19T20:00:00Z" });
    expect(day(r.batchDate)).toBe("2026-09-20");
    expect(day(r.expectedDepositDate)).toBe("2026-09-21");
  });

  it("failed, authOnly and no-snapshot rows carry gateway facts but no batch", () => {
    for (const o of [{ status: "failed" }, { transactionType: "authOnlyTransaction" }, { snapshot: false }, { chargeId: "0" }]) {
      const r = f(o);
      expect(r.batchDate).toBeNull();
      expect(r.expectedDepositDate).toBeNull();
      expect(r.batchWindowStart).toBeNull();
    }
    expect(f({ status: "failed" }).chargeId).toBe("900000000001");
  });
});

describe("dated rates", () => {
  const rows = Object.values(KURV_RATE_KEYS).map((key) => ({ key, value: "0.5", effectiveFrom: "2026-10-01" }));
  it("uses the latest row on or before the date and never an earlier-dated default", () => {
    const withNew = [...rows, { key: KURV_RATE_KEYS.discountRate, value: "0.03", effectiveFrom: new Date("2027-01-01T00:00:00Z") }];
    expect(rateAsOf(withNew, KURV_RATE_KEYS.discountRate, "2026-12-31")).toBe(0.5);
    expect(rateAsOf(withNew, KURV_RATE_KEYS.discountRate, "2027-01-01")).toBe(0.03);
    expect(() => rateAsOf(withNew, KURV_RATE_KEYS.discountRate, "2026-09-30")).toThrow(/no value effective/);
  });
  it("assembles a full KurvRates", () => {
    expect(Object.keys(kurvRatesAsOf(rows, "2026-10-15")).sort()).toEqual(Object.keys(KURV_RATE_KEYS).sort());
  });
});
