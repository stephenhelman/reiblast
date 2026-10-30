import { describe, expect, it } from "vitest";
import type { Batch } from "../../kurv/batch";
import type { KurvRates } from "../../kurv/fees";
import { assembleStatement, roundBreakdown, type StatementInputs } from "../assemble";
import { computeMonthStatement, outstandingBalance, reserveBalance, type StatementDb } from "../compute";
import type { MonthStatement, WalletDetail } from "../types";

const RATES: KurvRates = { discountRate: 0.029, perItem: 0.2, perBatch: 0.35, interchangeRate: 0.0044, reserveRate: 0.1, perAuth: 0.2, perAvs: 0.1, avsPerAuthRatio: 0.72, brandFeeRate: 0.006, fixedMonthly: 43.2 };
const RATE_ROWS = [
  ...Object.entries({
    kurv_discount_rate: 0.029, kurv_per_item: 0.2, kurv_per_batch: 0.35, kurv_interchange_rate: 0.0044, kurv_reserve_rate: 0.1, kurv_per_auth: 0.2,
    kurv_per_avs: 0.1, kurv_avs_per_auth_ratio: 0.72, kurv_brand_fee_rate: 0.006, kurv_fixed_monthly: 43.2, partner_split_pct: 0.5,
  }).map(([key, value]) => ({ key, value, effectiveFrom: new Date("2026-10-01T00:00:00Z") })),
];

const batch = (windowEnd: string, depositDate: string, items: number, grossCents: number): Batch => ({
  windowEnd, windowStart: new Date(`${windowEnd}T00:00:00Z`), batchDate: windowEnd, depositDate, items, nonAmexItems: items, grossCents,
});
const noWallet: WalletDetail = { debitCount: 0, breakdown: [], rechargeCreditsCents: 0, planRowsExcluded: { count: 0, cents: 0 }, hasData: true };

function inputs(over: Partial<StatementInputs> = {}): StatementInputs {
  return {
    month: "2026-10", batches: [batch("2026-10-05", "2026-10-06", 10, 100000)], activity: { captureAttempts: 100, authOnlyCount: 10, volumeCents: 0 },
    rates: RATES, splitPct: 0.5, kurvActual: null, fixedCosts: [{ name: "ghl_agency_plan", cents: 49700 }, { name: "authorize_net", cents: 2500 }],
    wallet: { ...noWallet, breakdown: [{ category: "outbound_sms", scope: "member", count: 5, cents: 1000 }, { category: "a2p_registration", scope: "agency", count: 1, cents: 1500 }, { category: "wallet_sales_tax", scope: "unattributed", count: 1, cents: 50 }] },
    reserveMovements: [], reserveOpeningCents: 51451, partial: false, now: new Date("2026-11-02T00:00:00Z"), ...over,
  };
}
const line = (s: MonthStatement, k: string) => s.lines.find((l) => l.key === k)!;

describe("assembleStatement", () => {
  it("net = deposits − debit − plan − authnet − wallet; owed = 50%", () => {
    const s = assembleStatement(inputs());
    // 100000 gross: discount 2900, other = 10*20 + 35 + 440 = 675, reserve 10000 → deposit 86425
    expect(s.deposits).toMatchObject({ grossCents: 100000, dailyFeesCents: 3575, reserveCents: 10000, depositCents: 86425, basis: "estimate" });
    const debit = line(s, "monthly_debit").amountCents;
    expect(s.netCents).toBe(86425 - debit - 49700 - 2500 - 2550);
    expect(s.owedCents).toBe(Math.round(s.netCents / 2));
    expect(line(s, "agency_wallet")).toMatchObject({ amountCents: 2550 }); // incl. A2P ($15) and tax ($0.50)
  });

  it("uses the entered Kurv statement for deposits and the monthly debit (estimate → actual)", () => {
    const est = assembleStatement(inputs());
    const act = assembleStatement(inputs({ kurvActual: { salesCount: 10, salesAmountCents: 100000, dailyFeesPaidCents: 3600, reserveFundedCents: 10000, monthlyDebitCents: 9000 } }));
    expect(line(est, "monthly_debit").basis).toBe("estimate");
    expect(est.monthlyDebit.estimate).not.toBeNull();
    expect(line(act, "monthly_debit")).toMatchObject({ basis: "actual", amountCents: 9000 });
    expect(act.monthlyDebit.estimate).toBeNull();
    expect(line(act, "deposits")).toMatchObject({ basis: "actual", amountCents: 100000 - 3600 - 10000 });
    expect(act.deposits.discountCents).toBeNull();
    expect(act.netCents).toBe(86400 - 9000 - 49700 - 2500 - 2550);
  });

  it("monthly debit estimate follows volume and is flagged to-date while the month is open", () => {
    const open = assembleStatement(inputs({ partial: true }));
    const e = open.monthlyDebit.estimate!;
    expect(open.monthlyDebit.toDateOnly).toBe(true);
    expect(e.authorizations).toBe(120);
    expect(e.authFeesCents).toBe(2400);
    expect(e.avsFeesCents).toBe(Math.round(120 * 0.72 * 0.1 * 100));
    expect(e.brandFeesCents).toBe(600);
    expect(e.fixedCents).toBe(4320);
  });

  it("reserve releases are excluded from income and never touch the split", () => {
    const base = assembleStatement(inputs());
    const withRelease = assembleStatement(inputs({ reserveMovements: [{ kind: "release", amountCents: 25000 }, { kind: "withdrawal", amountCents: 1000 }] }));
    expect(withRelease.deposits.depositCents).toBe(base.deposits.depositCents);
    expect(withRelease.netCents).toBe(base.netCents);
    expect(withRelease.owedCents).toBe(base.owedCents);
    expect(withRelease.reserve).toMatchObject({ fundedCents: 10000, releasesCents: 25000, withdrawalsCents: 1000 });
    expect(withRelease.reserve.closingBalanceCents).toBe(51451 + 10000 - 25000 - 1000);
  });

  it("roundBreakdown keeps the rows summing to the rounded total", () => {
    const micros = Math.round(-4_000_000 / 3);
    const r = roundBreakdown([
      { category: "a", scope: "member", count: 1, micros },
      { category: "b", scope: "hq", count: 1, micros },
      { category: "c", scope: "agency", count: 1, micros },
    ]);
    expect(r.rows.reduce((s, x) => s + x.cents, 0)).toBe(r.totalCents);
  });
});

/** In-memory StatementDb. `touched` records which delegates a call used. */
function fakeDb(o: { ledger?: any[]; kurv?: any[]; closes?: any[]; payments?: any[]; moves?: any[]; strict?: boolean } = {}) {
  const touched: string[] = [];
  const guard = (name: string, fn: (...a: any[]) => any) => (...a: any[]) => {
    touched.push(name);
    return fn(...a);
  };
  const db: any = {
    billingLedgerEntry: {
      findMany: guard("ledger.findMany", ({ where }: any) => (o.ledger ?? []).filter((r) => r.expectedDepositDate >= where.expectedDepositDate.gte && r.expectedDepositDate < where.expectedDepositDate.lt)),
      groupBy: guard("ledger.groupBy", () => []),
    },
    settingRate: { findMany: guard("rate", () => RATE_ROWS) },
    fixedCost: { findMany: guard("fixed", () => [{ name: "ghl_agency_plan", monthlyAmountCents: 49700 }, { name: "authorize_net", monthlyAmountCents: 2500 }]) },
    kurvStatement: { findUnique: guard("kurv", ({ where }: any) => (o.kurv ?? []).find((k) => k.month === where.month) ?? null) },
    reserveMovement: { findMany: guard("moves", ({ where }: any = {}) => (o.moves ?? []).filter((m) => !where || (m.date >= where.date.gte && m.date < where.date.lt))) },
    monthClose: {
      findUnique: guard("close.find", ({ where }: any) => (o.closes ?? []).find((c) => c.month === where.month) ?? null),
      aggregate: guard("close.agg", () => ({ _sum: { owedAmountCents: (o.closes ?? []).filter((c) => c.reopenedAt === null).reduce((s, c) => s + c.owedAmountCents, 0) } })),
    },
    partnerPayment: { aggregate: guard("pay.agg", () => ({ _sum: { amountCents: (o.payments ?? []).reduce((s, p) => s + p.amountCents, 0) } })) },
    $queryRaw: guard("raw", () => []),
  };
  return { db: db as StatementDb, touched };
}

const row = (windowStart: string, deposit: string, cents: number) => ({
  batchWindowStart: new Date(windowStart), batchDate: new Date(deposit), expectedDepositDate: new Date(`${deposit}T00:00:00Z`), settleAmountCents: cents, cardBrand: "Visa",
});

describe("computeMonthStatement", () => {
  it("refuses months before the statement start and malformed months", async () => {
    const { db } = fakeDb();
    await expect(computeMonthStatement(db, "2026-09")).rejects.toThrow(/starts 2026-10-01/);
    await expect(computeMonthStatement(db, "nope")).rejects.toThrow(/Invalid month/);
  });

  it("deposit-month boundary: a batch deposits in the month of its deposit date, not its sale date", async () => {
    // Window ending Thu Oct 29 (opens Oct 28 23:00Z) deposits Fri Oct 30 → October. Window ending Fri Oct 30 deposits Mon Nov 2 → November.
    const ledger = [row("2026-10-28T23:00:00Z", "2026-10-30", 5000), row("2026-10-29T23:00:00Z", "2026-11-02", 7000)];
    const { db } = fakeDb({ ledger });
    const oct = await computeMonthStatement(db, "2026-10", { hq: null, now: new Date("2026-11-05T00:00:00Z") });
    const nov = await computeMonthStatement(db, "2026-11", { hq: null, now: new Date("2026-11-05T00:00:00Z") });
    expect(oct.deposits.grossCents).toBe(5000);
    expect(nov.deposits.grossCents).toBe(7000);
  });

  it("an entered Kurv statement flips the lines to actual", async () => {
    const { db } = fakeDb({ kurv: [{ month: "2026-10", salesCount: 3, salesAmountCents: 20000, dailyFeesPaidCents: 800, reserveFundedCents: 2000, monthlyDebitCents: 5000 }] });
    const s = await computeMonthStatement(db, "2026-10", { hq: null, now: new Date("2026-11-05T00:00:00Z") });
    expect(s.lines.filter((l) => l.key === "deposits" || l.key === "monthly_debit").map((l) => l.basis)).toEqual(["actual", "actual"]);
  });

  it("a closed month returns its snapshot and recomputes nothing (immutable)", async () => {
    const snapshot = assembleStatement(inputs());
    const { db, touched } = fakeDb({ closes: [{ month: "2026-10", closedAt: new Date("2026-11-03T12:00:00Z"), snapshot, owedAmountCents: snapshot.owedCents, reopenedAt: null }] });
    const s = await computeMonthStatement(db, "2026-10", { now: new Date("2027-03-01T00:00:00Z") });
    expect(s).toEqual({ ...snapshot, closed: true, closedAt: "2026-11-03T12:00:00.000Z" });
    expect(touched).toEqual(["close.find"]); // never read the ledger, rates, wallet or reserve
  });

  it("a reopened month is recomputed live", async () => {
    const stale = assembleStatement(inputs());
    const { db } = fakeDb({ closes: [{ month: "2026-10", closedAt: new Date("2026-11-03T12:00:00Z"), snapshot: stale, owedAmountCents: stale.owedCents, reopenedAt: new Date("2026-11-04T00:00:00Z") }] });
    const s = await computeMonthStatement(db, "2026-10", { hq: null, now: new Date("2026-11-05T00:00:00Z") });
    expect(s.closed).toBe(false);
    expect(s.deposits.grossCents).toBe(0);
  });
});

describe("balances", () => {
  it("outstanding = Σ owed (closed) − Σ payments", async () => {
    const { db } = fakeDb({ closes: [{ month: "2026-10", owedAmountCents: 100000, reopenedAt: null }, { month: "2026-11", owedAmountCents: 50000, reopenedAt: null }], payments: [{ amountCents: 30000 }, { amountCents: 20000 }] });
    expect(await outstandingBalance(db)).toEqual({ owedClosedCents: 150000, paidCents: 50000, outstandingCents: 100000 });
  });

  it("reserve balance = opening + funded + movements (releases and withdrawals reduce it)", async () => {
    const moves = [
      { date: new Date("2026-09-30T00:00:00Z"), kind: "adjustment", amountCents: 51451 },
      { date: new Date("2026-10-20T00:00:00Z"), kind: "release", amountCents: 10000 },
    ];
    const ledger = [row("2026-10-05T23:00:00Z", "2026-10-06", 100000)];
    const { db } = fakeDb({ moves, ledger });
    expect(await reserveBalance(db, "2026-10")).toBe(51451 + 10000 - 10000);
    expect(await reserveBalance(db, "2026-09")).toBe(51451); // before the statement start: opening only
  });
});
