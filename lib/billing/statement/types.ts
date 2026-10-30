/** Partner statement shapes. JSON-safe (no Dates, no Decimals): a closed month stores this verbatim as its snapshot. */
export type Basis = "estimate" | "actual";

export type StatementLine = {
  key: "deposits" | "monthly_debit" | "agency_plan" | "authorize_net" | "agency_wallet";
  label: string;
  /** Positive magnitude. Deposits add to the net; every other line is subtracted. */
  amountCents: number;
  basis: Basis;
  /** Where the number comes from, in words (shown next to the line). */
  source: string;
};

export type DepositBreakdown = {
  batches: number;
  items: number;
  grossCents: number;
  /** Discount + per-item + per-batch + interchange. */
  dailyFeesCents: number;
  /** Split of dailyFeesCents; null when the Kurv statement was entered (it reports one daily-fees total). */
  discountCents: number | null;
  otherFeesCents: number | null;
  reserveCents: number;
  /** gross − daily fees − reserve. */
  depositCents: number;
  basis: Basis;
};

export type MonthlyDebitDetail = {
  basis: Basis;
  /** Only present for an estimate. AVS is itself an estimate (authorizations × avsPerAuthRatio). */
  estimate: { authorizations: number; authFeesCents: number; avsFeesCents: number; brandFeesCents: number; fixedCents: number } | null;
  /** True when the month hasn't finished: the estimate covers activity to date, so it will rise. */
  toDateOnly: boolean;
};

export type WalletBreakdownRow = { category: string; scope: "member" | "hq" | "agency" | "unattributed"; count: number; cents: number };

export type WalletDetail = {
  debitCount: number;
  breakdown: WalletBreakdownRow[];
  /** Agency recharge credits in the month. Informational; never part of the cost. */
  rechargeCreditsCents: number;
  /** Rows that looked like the agency plan and were left out to avoid counting the $497 twice. */
  planRowsExcluded: { count: number; cents: number };
  /** No wallet rows at all in the month → the wallet job hasn't run; the line is $0, not "no usage". */
  hasData: boolean;
};

export type ReserveMonth = {
  /** Reserve funded by this month's deposits (10% of settled sales). Company money, never split. */
  fundedCents: number;
  releasesCents: number;
  withdrawalsCents: number;
  adjustmentsCents: number;
  /** Balance at the end of this month (opening + funded − releases − withdrawals ± adjustments, all months to date). */
  closingBalanceCents: number;
};

export type MonthStatement = {
  month: string;
  closed: boolean;
  closedAt: string | null;
  /** The month hasn't finished (or its last batches haven't deposited yet): every figure is to-date. */
  partial: boolean;
  generatedAt: string;
  lines: StatementLine[];
  deposits: DepositBreakdown;
  monthlyDebit: MonthlyDebitDetail;
  wallet: WalletDetail;
  netCents: number;
  splitPct: number;
  /** splitPct × net. */
  owedCents: number;
  reserve: ReserveMonth;
};
