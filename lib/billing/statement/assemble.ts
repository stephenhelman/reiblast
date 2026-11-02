import type { Batch } from "../kurv/batch";
import { estimateMonthlyDebit, sumBatchFees, type KurvRates, type MonthlyActivity } from "../kurv/fees";
import { movementDelta, type ReserveMovement } from "../kurv/reserve";
import type { Basis, DepositBreakdown, MonthlyDebitDetail, MonthStatement, StatementLine, WalletBreakdownRow, WalletDetail } from "./types";

export type KurvActual = { salesCount: number; salesAmountCents: number; dailyFeesPaidCents: number; reserveFundedCents: number; monthlyDebitCents: number };

export type StatementInputs = {
  month: string;
  /** Batches whose deposit date falls in the month. */
  batches: readonly Batch[];
  activity: MonthlyActivity;
  rates: KurvRates;
  splitPct: number;
  /** The entered Kurv statement for the month, if any. Replaces the estimates. */
  kurvActual: KurvActual | null;
  fixedCosts: readonly { name: string; cents: number }[];
  wallet: WalletDetail;
  /** This month's reserve movements. */
  reserveMovements: readonly ReserveMovement[];
  /** Reserve balance at the END of the previous month (opening + all earlier funded and movements). */
  reserveOpeningCents: number;
  partial: boolean;
  now: Date;
};

export const FIXED_COST_LABEL: Record<string, string> = { ghl_agency_plan: "GHL agency plan", authorize_net: "Authorize.net" };

export function assembleStatement(i: StatementInputs): MonthStatement {
  // Deposits: bank deposits = sales − daily fees (incl. discount) − reserve funded. Reserve RELEASES are separate bank
  // deposits and are deliberately not part of this figure.
  let deposits: DepositBreakdown;
  if (i.kurvActual) {
    const a = i.kurvActual;
    deposits = {
      batches: i.batches.length, items: a.salesCount, grossCents: a.salesAmountCents, dailyFeesCents: a.dailyFeesPaidCents, discountCents: null, otherFeesCents: null,
      reserveCents: a.reserveFundedCents, depositCents: a.salesAmountCents - a.dailyFeesPaidCents - a.reserveFundedCents, basis: "actual",
    };
  } else {
    const f = sumBatchFees(i.batches, i.rates);
    deposits = {
      batches: f.batches, items: f.items, grossCents: f.grossCents, dailyFeesCents: f.discountCents + f.otherFeesCents, discountCents: f.discountCents, otherFeesCents: f.otherFeesCents,
      reserveCents: f.reserveCents, depositCents: f.depositCents, basis: "estimate",
    };
  }

  let monthlyDebit: MonthlyDebitDetail;
  let debitCents: number;
  if (i.kurvActual) {
    debitCents = i.kurvActual.monthlyDebitCents;
    monthlyDebit = { basis: "actual", estimate: null, toDateOnly: false };
  } else {
    const e = estimateMonthlyDebit({ ...i.activity, volumeCents: deposits.grossCents }, i.rates);
    debitCents = e.totalCents;
    monthlyDebit = { basis: "estimate", estimate: { authorizations: e.authorizations, authFeesCents: e.authFeesCents, avsFeesCents: e.avsFeesCents, brandFeesCents: e.brandFeesCents, fixedCents: e.fixedCents }, toDateOnly: i.partial };
  }

  const cost = (name: string) => i.fixedCosts.find((c) => c.name === name)?.cents ?? 0;
  const walletCents = i.wallet.breakdown.reduce((s, r) => s + r.cents, 0);
  const lines: StatementLine[] = [
    { key: "deposits", label: "Bank deposits", amountCents: deposits.depositCents, basis: deposits.basis, source: i.kurvActual ? "Kurv statement (entered): sales − daily fees − reserve" : "Settled batches by deposit date: sales − daily fees − 10% reserve (rates estimate)" },
    { key: "monthly_debit", label: "Kurv monthly debit", amountCents: debitCents, basis: monthlyDebit.basis, source: i.kurvActual ? "Kurv statement (entered)" : "Estimate: $0.20/auth + AVS estimate + ~0.6% brand fees + fixed fees. Posts ~1st of next month" },
    { key: "agency_plan", label: "GHL agency plan", amountCents: cost("ghl_agency_plan"), basis: "actual", source: "Dated fixed cost" },
    { key: "authorize_net", label: "Authorize.net", amountCents: cost("authorize_net"), basis: "actual", source: "Dated fixed cost" },
    { key: "agency_wallet", label: "GHL agency wallet usage", amountCents: walletCents, basis: "actual", source: "All agency wallet debits (members, HQ, agency, unattributed; incl. A2P and tax), excluding recharge credits" },
  ];

  const netCents = deposits.depositCents - debitCents - cost("ghl_agency_plan") - cost("authorize_net") - walletCents;
  const owedCents = Math.round(netCents * i.splitPct);

  const sum = (kind: ReserveMovement["kind"]) => i.reserveMovements.filter((m) => m.kind === kind).reduce((s, m) => s + Math.abs(m.amountCents), 0);
  const adjustments = i.reserveMovements.filter((m) => m.kind === "adjustment").reduce((s, m) => s + m.amountCents, 0);
  const reserve = {
    fundedCents: deposits.reserveCents,
    releasesCents: sum("release"),
    withdrawalsCents: sum("withdrawal"),
    adjustmentsCents: adjustments,
    closingBalanceCents: i.reserveOpeningCents + deposits.reserveCents + i.reserveMovements.reduce((s, m) => s + movementDelta(m), 0),
  };

  return { month: i.month, closed: false, closedAt: null, partial: i.partial, generatedAt: i.now.toISOString(), lines, deposits, monthlyDebit, wallet: i.wallet, netCents, splitPct: i.splitPct, owedCents, reserve };
}

/** Rounds per-row sums (integer micro-dollars) to cents while keeping the breakdown summing to the rounded total (remainder goes to the largest row). */
export function roundBreakdown(rows: { category: string; scope: WalletBreakdownRow["scope"]; count: number; micros: number }[]): { rows: WalletBreakdownRow[]; totalCents: number } {
  const toCents = (m: number) => Math.sign(m) * Math.round(Math.abs(m) / 10000); // half away from zero
  const total = toCents(rows.reduce((s, r) => s + r.micros, 0));
  const out = rows.map((r) => ({ category: r.category, scope: r.scope, count: r.count, cents: toCents(r.micros) }));
  const diff = total - out.reduce((s, r) => s + r.cents, 0);
  if (diff !== 0 && out.length) {
    const big = out.reduce((a, b) => (Math.abs(b.cents) > Math.abs(a.cents) ? b : a));
    big.cents += diff;
  }
  return { rows: out, totalCents: total };
}

export type { Basis };
