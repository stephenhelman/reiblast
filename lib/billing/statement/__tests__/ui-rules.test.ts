import { describe, expect, it } from "vitest";
import { canCloseMonth } from "../close";
import { statementRows } from "../csvRows";
import { assembleStatement } from "../assemble";
import { lineDataThrough, staleSources, type Freshness } from "../freshness";
import type { KurvRates } from "../../kurv/fees";

const now = new Date("2026-11-03T12:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3600_000);
const F = (o: Partial<Freshness> = {}): Freshness => ({ ledgerAt: h(1), walletLastRowAt: h(20), walletIngestedAt: h(3), kurvEnteredAt: null, ...o });

describe("canCloseMonth", () => {
  it("needs the month to have ended AND a Kurv statement", () => {
    expect(canCloseMonth({ month: "2026-10", now: new Date("2026-10-31T12:00:00Z"), hasKurvStatement: true, alreadyClosed: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/hasn't ended/) });
    expect(canCloseMonth({ month: "2026-10", now, hasKurvStatement: false, alreadyClosed: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/Kurv statement/) });
    expect(canCloseMonth({ month: "2026-10", now, hasKurvStatement: true, alreadyClosed: false })).toEqual({ ok: true });
    expect(canCloseMonth({ month: "2026-10", now, hasKurvStatement: true, alreadyClosed: true }).ok).toBe(false);
  });
  it("the month ends at Denver midnight, not UTC midnight", () => {
    // 2026-11-01 05:59Z is still Oct 31 23:59 MDT? (Nov 1 is fall-back: MDT until 08:00Z) — still October in Denver.
    expect(canCloseMonth({ month: "2026-10", now: new Date("2026-11-01T05:59:00Z"), hasKurvStatement: true, alreadyClosed: false }).ok).toBe(false);
    expect(canCloseMonth({ month: "2026-10", now: new Date("2026-11-01T06:00:00Z"), hasKurvStatement: true, alreadyClosed: false }).ok).toBe(true);
  });
});

describe("staleSources (26h rule)", () => {
  it("flags a source older than 26h and one that was never loaded", () => {
    expect(staleSources(F(), now)).toEqual([]);
    expect(staleSources(F({ walletIngestedAt: h(26.5) }), now).map((s) => s.key)).toEqual(["wallet"]);
    expect(staleSources(F({ ledgerAt: h(30), walletIngestedAt: null }), now).map((s) => s.key)).toEqual(["ledger", "wallet"]);
    expect(staleSources(F({ walletIngestedAt: h(25.9) }), now)).toEqual([]);
  });
});

const RATES: KurvRates = { discountRate: 0.029, perItem: 0.2, perBatch: 0.35, interchangeRate: 0.0044, reserveRate: 0.1, perAuth: 0.2, perAvs: 0.1, avsPerAuthRatio: 0.72, brandFeeRate: 0.006, fixedMonthly: 43.2 };
const stmt = (actual: boolean) =>
  assembleStatement({
    month: "2026-10", batches: [], activity: { captureAttempts: 0, authOnlyCount: 0, volumeCents: 0 }, rates: RATES, splitPct: 0.5,
    kurvActual: actual ? { salesCount: 1, salesAmountCents: 1000, dailyFeesPaidCents: 50, reserveFundedCents: 100, monthlyDebitCents: 4400 } : null,
    fixedCosts: [], wallet: { debitCount: 0, breakdown: [], rechargeCreditsCents: 0, planRowsExcluded: { count: 0, cents: 0 }, hasData: false },
    reserveMovements: [], reserveOpeningCents: 0, partial: true, now,
  });

describe("lineDataThrough", () => {
  it("estimates point at the ledger, actuals at the Kurv entry, wallet at its last row", () => {
    const est = lineDataThrough(stmt(false), F());
    expect(est.deposits.text).toMatch(/Ledger/);
    expect(est.monthly_debit.text).toMatch(/Estimate/);
    expect(est.agency_wallet).toMatchObject({ text: "No wallet rows loaded" });
    const entered = h(2);
    const act = lineDataThrough(stmt(true), F({ kurvEnteredAt: entered }));
    expect(act.deposits).toEqual({ text: "Kurv statement entered", at: entered });
    expect(act.monthly_debit.at).toBe(entered);
  });
  it("a closed month is frozen at close", () => {
    const closed = { ...stmt(true), closed: true, closedAt: "2026-11-03T00:00:00.000Z" };
    expect(lineDataThrough(closed, F()).agency_wallet.text).toBe("Frozen at close");
  });
});

describe("statement CSV rows", () => {
  it("labels owed 'to date' while open and carries every line", () => {
    const rows = statementRows(stmt(false));
    expect(rows.filter((r) => r.section === "line")).toHaveLength(5);
    expect(rows.find((r) => String(r.label).startsWith("Owed to Stephen"))!.label).toMatch(/\(to date\)$/);
    expect(statementRows({ ...stmt(true), closed: true, closedAt: "x" }).find((r) => String(r.label).startsWith("Owed"))!.label).not.toMatch(/to date/);
  });
});
