import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { batchDateOf, batchesDepositedIn, groupBatches, windowEndDay, windowStartInstant, type KurvTx } from "../batch";
import { addDays, fedHolidays, isBankDay, nextBankDay } from "../calendar";
import { batchFees, estimateMonthlyDebit, monthlyActivity, sumBatchFees, type KurvRates } from "../fees";
import { releasesTotal, reserveBalance } from "../reserve";

// Rates here mirror what the dated SettingRate table will hold (seeded effective 2026-10-01); the module itself has no defaults.
const RATES: KurvRates = {
  discountRate: 0.029, perItem: 0.2, perBatch: 0.35, interchangeRate: 0.0044, reserveRate: 0.1,
  perAuth: 0.2, perAvs: 0.1, avsPerAuthRatio: 0.72, brandFeeRate: 0.006, fixedMonthly: 43.2,
};

// Known unsettled $57 charge on Aug 19 (one of two identical $57 rows; the pair is indistinguishable for fees). Explicit exclusion, not a code hack.
const KNOWN_UNSETTLED = new Set(["121785351029"]);

const FIXTURE = path.join(__dirname, "../../../../scripts/billing-audit/output/tx_2026-08-19_2026-09-30.json");
const hasFixture = fs.existsSync(FIXTURE);

/** Test-only mapper from the audit fixture's raw GHL rows. Production reads raw only via normalizeTransaction. */
function loadFixture(): KurvTx[] {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).data as any[];
  return raw.map((x) => ({
    chargeId: String(x.chargeId),
    status: x.status,
    transactionType: x.chargeSnapshot?.transactionType ?? null,
    submitTimeUtc: x.chargeSnapshot?.submitTimeUTC ?? null,
    settleAmount: x.chargeSnapshot?.settleAmount ?? null,
    cardBrand: x.chargeSnapshot?.payment?.creditCard?.cardType ?? null,
  }));
}

const dollars = (c: number) => (c / 100).toFixed(2);
const near = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const within = (actual: number, expected: number, pct: number) => expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(pct);

describe("calendar", () => {
  it("computes Federal Reserve holidays (Sat holidays not observed, Sun → Mon)", () => {
    const h26 = fedHolidays(2026);
    for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) expect(h26.has(d), d).toBe(true);
    expect(h26.has("2026-07-03")).toBe(false); // Jul 4 is a Saturday: the Fed does not observe it on Friday
  });
  it("Saturday holiday is not observed on Friday for the Fed", () => {
    // Jul 4 2026 is a Saturday: Fed banks stay open Friday Jul 3.
    expect(isBankDay("2026-07-03")).toBe(true);
    // Nov 11 2023 was Saturday; Dec 25 2022 was Sunday → Mon Dec 26.
    expect(isBankDay("2022-12-26")).toBe(false);
  });
  it("nextBankDay skips weekends and holidays", () => {
    expect(nextBankDay("2026-09-04")).toBe("2026-09-08"); // Fri before Labor Day
    expect(nextBankDay("2026-09-30")).toBe("2026-10-01");
    expect(nextBankDay("2026-10-09")).toBe("2026-10-13"); // Columbus Day Mon Oct 12
    expect(nextBankDay("2026-08-30")).toBe("2026-08-31");
  });
  it("addDays crosses months", () => expect(addDays("2026-09-30", 1)).toBe("2026-10-01"));
});

describe("batch windows", () => {
  it("5 PM Denver cutoff, DST-aware", () => {
    expect(windowEndDay("2026-09-21T22:59:59Z")).toBe("2026-09-21"); // 16:59:59 MDT
    expect(windowEndDay("2026-09-21T23:00:00Z")).toBe("2026-09-22"); // 17:00 MDT
    expect(windowEndDay("2026-12-02T23:59:59Z")).toBe("2026-12-02"); // 16:59:59 MST
    expect(windowEndDay("2026-12-03T00:00:00Z")).toBe("2026-12-03"); // 17:00 MST
    expect(windowStartInstant("2026-09-22").toISOString()).toBe("2026-09-21T23:00:00.000Z");
    expect(windowStartInstant("2026-11-02").toISOString()).toBe("2026-11-02T00:00:00.000Z"); // Nov 1 5 PM is MST (fall-back day)
  });
  it("Saturday's window is its own window, labeled Sunday", () => {
    expect(windowEndDay("2026-09-19T20:00:00Z")).toBe("2026-09-19"); // Sat 2pm MDT
    expect(batchDateOf("2026-09-19T20:00:00Z")).toBe("2026-09-20");
    expect(windowEndDay("2026-09-20T20:00:00Z")).toBe("2026-09-20"); // Sun 2pm
    expect(batchDateOf("2026-09-20T20:00:00Z")).toBe("2026-09-20");
  });
});

describe("reserve", () => {
  it("balance = opening + funded − releases − withdrawals ± adjustments", () => {
    const mv = [{ kind: "release" as const, amountCents: 10000 }, { kind: "withdrawal" as const, amountCents: 2500 }, { kind: "adjustment" as const, amountCents: -100 }];
    expect(reserveBalance(51451, 41953, mv)).toBe(51451 + 41953 - 10000 - 2500 - 100);
    expect(releasesTotal(mv)).toBe(10000);
  });
});

describe.skipIf(!hasFixture)("Aug/Sep 2026 reconciliation against Kurv statements", () => {
  const all = hasFixture ? loadFixture() : [];
  const batches = groupBatches(all, { excludeChargeIds: KNOWN_UNSETTLED });
  const byLabel = (label: string) => batches.filter((b) => b.batchDate === label);
  const day = (label: string) => {
    const bs = byLabel(label);
    return { windows: bs.length, items: bs.reduce((s, b) => s + b.items, 0), gross: dollars(bs.reduce((s, b) => s + b.grossCents, 0)) };
  };

  it("daily batches", () => {
    expect(day("2026-09-20")).toEqual({ windows: 2, items: 9, gross: "240.96" });
    expect(day("2026-09-21")).toEqual({ windows: 1, items: 15, gross: "461.61" });
    expect(day("2026-09-22")).toEqual({ windows: 1, items: 8, gross: "299.90" });
  });

  it("Aug statement month = 47 sales / $949.71 (after the unsettled $57)", () => {
    const aug = batchesDepositedIn(batches, "2026-08");
    expect(aug.reduce((s, b) => s + b.items, 0)).toBe(47);
    expect(dollars(aug.reduce((s, b) => s + b.grossCents, 0))).toBe("949.71");
    // without the exclusion the fixture would show one more $57 item
    const raw = batchesDepositedIn(groupBatches(all), "2026-08");
    expect(raw.reduce((s, b) => s + b.items, 0)).toBe(48);
  });

  it("Sep statement month = 194 sales / $4,195.12, and Sep 30's batch (8/$184.45) deposits Oct 1", () => {
    const sep = batchesDepositedIn(batches, "2026-09");
    expect(sep.reduce((s, b) => s + b.items, 0)).toBe(194);
    expect(dollars(sep.reduce((s, b) => s + b.grossCents, 0))).toBe("4195.12");
    const sep30 = batches.find((b) => b.windowEnd === "2026-09-30")!;
    expect([sep30.items, dollars(sep30.grossCents), sep30.depositDate]).toEqual([8, "184.45", "2026-10-01"]);
    expect(batchesDepositedIn(batches, "2026-09").some((b) => b.windowEnd === "2026-09-30")).toBe(false);
  });

  it("Sep fees: discount, reserve, daily fees, batch count", () => {
    const sep = batchesDepositedIn(batches, "2026-09");
    expect(sep.length).toBe(30);
    const f = sumBatchFees(sep, RATES);
    near(f.discountCents, 12167, 2);
    near(f.reserveCents, 41953, 5);
    within(f.otherFeesCents, 6667, 0.02);
    console.log("SEP daily", { discount: f.discountCents, other: f.otherFeesCents, reserve: f.reserveCents, deposit: f.depositCents, batches: f.batches });
  });

  const monthRows = (month: string) => all.filter((t) => t.submitTimeUtc && t.chargeId !== "0" && new Date(t.submitTimeUtc).toLocaleString("sv-SE", { timeZone: "America/Denver" }).startsWith(month));
  const volume = (month: string) => batchesDepositedIn(batches, month).reduce((s, b) => s + b.grossCents, 0);

  it("Sep monthly debit estimate ≈ $176.56 (±2%, AVS via avsPerAuthRatio estimate)", () => {
    const est = estimateMonthlyDebit(monthlyActivity(monthRows("2026-09"), volume("2026-09")), RATES);
    console.log("SEP monthly", est, monthlyActivity(monthRows("2026-09"), volume("2026-09")));
    within(est.totalCents, 17656, 0.02);
  });

  it("Aug monthly debit is a known first-month exception: Kurv billed $66.07 without the fixed fees", () => {
    const a = monthlyActivity(monthRows("2026-08"), volume("2026-08"));
    const est = estimateMonthlyDebit(a, RATES);
    console.log("AUG monthly", est, a);
    // Documented, not tuned: the model (which includes the $43.20 fixed fees) overshoots the actual $66.07 by roughly the fixed fees.
    expect(est.totalCents).toBeGreaterThan(6607);
    expect(est.totalCents - est.fixedCents).toBeLessThan(6607 * 1.25);
    expect(est.totalCents - 6607).toBeGreaterThan(est.fixedCents * 0.5);
  });

  it("single batch fee sanity", () => {
    const b = byLabel("2026-09-21")[0];
    const f = batchFees(b, RATES);
    expect(f.depositCents).toBe(b.grossCents - f.discountCents - f.otherFeesCents - f.reserveCents);
  });
});
