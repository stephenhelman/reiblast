import { describe, expect, it } from "vitest";
import { canCloseMonth } from "../close";
import { statementRows } from "../csvRows";
import { assembleStatement } from "../assemble";
import { lineDataThrough, staleSources, type Freshness } from "../freshness";
import type { KurvRates } from "../../kurv/fees";

const now = new Date("2026-11-03T12:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3600_000);
const F = (o: Partial<Freshness> = {}): Freshness => ({ ledgerAt: h(1), walletLastRowAt: h(20), walletIngestedAt: h(3), kurvEnteredAt: null, ...o });

const refreshed = { windowsDone: 12, windowsTotal: 12, completedAt: new Date("2026-11-04T00:00:00Z") };
const closeIn = (o: Partial<Parameters<typeof canCloseMonth>[0]> = {}) => canCloseMonth({ month: "2026-10", now, hasKurvStatement: true, alreadyClosed: false, walletRefresh: refreshed, ...o });

describe("canCloseMonth", () => {
  it("needs the month ended AND the wallet refresh complete AND a Kurv statement", () => {
    expect(closeIn()).toEqual({ ok: true });
    expect(closeIn({ now: new Date("2026-10-31T12:00:00Z") })).toMatchObject({ ok: false, reason: expect.stringMatching(/hasn't ended/) });
    expect(closeIn({ hasKurvStatement: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/Kurv statement/) });
    expect(closeIn({ alreadyClosed: true }).ok).toBe(false);
  });
  it("blocks while the wallet refresh is missing or partial, and says how far it is", () => {
    expect(closeIn({ walletRefresh: null })).toMatchObject({ ok: false, reason: expect.stringMatching(/hasn't started/) });
    expect(closeIn({ walletRefresh: { windowsDone: 4, windowsTotal: 12, completedAt: null } })).toMatchObject({ ok: false, reason: expect.stringMatching(/4\/12 windows/) });
  });
  it("the month ends at Denver midnight, not UTC midnight", () => {
    expect(closeIn({ now: new Date("2026-11-01T05:59:00Z") }).ok).toBe(false);
    expect(closeIn({ now: new Date("2026-11-01T06:00:00Z") }).ok).toBe(true);
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
