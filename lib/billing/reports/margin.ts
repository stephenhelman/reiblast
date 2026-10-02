import { monthsBetween } from "./denver";
import { add, cmp, norm, pctOf, sub, sumOf, ZERO, type Money } from "./money";
import { netOf, isRevenue, monthOf, revenueClassOf, type LedgerRow, type RevenueMonth } from "./revenue";
import type { summarizeCosts } from "./costs";

/** Cash view only: money collected through GHL vs cash paid to GHL. Processor fees, chargebacks and payouts are not in the data. */

export type AgencyMarginRow = { month: string; netRevenue: Money; agencyCash: Money; tax: Money; margin: Money; feeEstimate: Money | null; marginAfterFeeEstimate: Money | null };

/** A valid ADMIN_PROCESSOR_FEE_PCT (0 < pct < 100), else null → the estimate line is hidden. */
export function parseFeePct(v: string | undefined | null): string | null {
  if (!v || !/^\d+(\.\d+)?$/.test(v.trim())) return null;
  const n = Number(v);
  return n > 0 && n < 100 ? v.trim() : null;
}

/**
 * Pure. Gross cash margin = net revenue collected (revenue rule) − agency recharges paid to GHL (auto + manual)
 * − wallet sales tax. Months are Denver months; every month in the range appears.
 */
export function buildAgencyMargin(revenue: RevenueMonth[], costMonths: ReturnType<typeof summarizeCosts>["byMonth"], feePct: string | null): { rows: AgencyMarginRow[]; totals: Omit<AgencyMarginRow, "month"> } {
  const costBy = new Map(costMonths.map((m) => [m.month, m.byGroup]));
  const rows = revenue.map((r): AgencyMarginRow => {
    const g = costBy.get(r.month);
    const agencyCash = norm(g?.agency_cash ?? ZERO);
    const tax = norm(g?.tax ?? ZERO);
    const margin = sub(sub(r.net, agencyCash), tax);
    const feeEstimate = feePct ? pctOf(r.net, feePct) : null;
    return { month: r.month, netRevenue: r.net, agencyCash, tax, margin, feeEstimate, marginAfterFeeEstimate: feeEstimate ? sub(margin, feeEstimate) : null };
  });
  const t = {
    netRevenue: sumOf(rows.map((r) => r.netRevenue)),
    agencyCash: sumOf(rows.map((r) => r.agencyCash)),
    tax: sumOf(rows.map((r) => r.tax)),
    margin: sumOf(rows.map((r) => r.margin)),
    feeEstimate: feePct ? sumOf(rows.map((r) => r.feeEstimate as Money)) : null,
    marginAfterFeeEstimate: feePct ? sumOf(rows.map((r) => r.marginAfterFeeEstimate as Money)) : null,
  };
  return { rows, totals: t };
}

export type MemberMarginInput = { accountId: string; locationId: string | null };
export type MemberMarginRow = MemberMarginInput & { recharges: Money; core: Money; other: Money; collected: Money; usage: Money; usageCount: number; net: Money; ledgerRows: number };
export const MEMBER_MARGIN_SORTS = ["net", "collected", "recharges", "core", "usage", "label"] as const;
export type MemberMarginSort = (typeof MEMBER_MARGIN_SORTS)[number];

/**
 * Pure. Per member over a range: wallet recharges collected + core collected (revenue rule, net of refunds) vs wallet
 * usage charged (member scope). net = collected − usage. Ledger rows with no account become the "Unmatched" line;
 * only member accounts are listed (internal accounts and HQ are excluded by the caller's inputs).
 */
export function buildMemberMargin(
  members: MemberMarginInput[],
  ledger: LedgerRow[],
  usage: Map<string, { cost: Money; count: number }>,
  range: { fromMonth: string; toMonth: string },
) {
  const months = new Set(monthsBetween(range.fromMonth, range.toMonth));
  const zero = () => ({ recharges: ZERO, core: ZERO, other: ZERO, ledgerRows: 0 });
  const byAcct = new Map<string, ReturnType<typeof zero>>();
  const unmatched = zero();
  const memberIds = new Set(members.map((m) => m.accountId));
  let unlistedRevenue = ZERO; // revenue attributed to an account that isn't a listed member (e.g. an internal account) — surfaced, never dropped

  for (const r of ledger) {
    if (!isRevenue(r) || !months.has(monthOf(r))) continue;
    const n = netOf(r);
    const k = revenueClassOf(r.classification);
    const target = r.ghlAccountId === null ? unmatched : memberIds.has(r.ghlAccountId) ? (byAcct.get(r.ghlAccountId) ?? byAcct.set(r.ghlAccountId, zero()).get(r.ghlAccountId)!) : null;
    if (!target) {
      unlistedRevenue = add(unlistedRevenue, n);
      continue;
    }
    if (k === "core_subscription") target.core = add(target.core, n);
    else if (k === "other") target.other = add(target.other, n);
    else target.recharges = add(target.recharges, n);
    target.ledgerRows += 1;
  }

  const rows: MemberMarginRow[] = [];
  for (const m of members) {
    const l = byAcct.get(m.accountId) ?? zero();
    const u = (m.locationId ? usage.get(m.locationId) : undefined) ?? { cost: ZERO, count: 0 };
    if (l.ledgerRows === 0 && u.count === 0) continue; // no activity in range
    const collected = sumOf([l.recharges, l.core, l.other]);
    rows.push({ ...m, ...l, collected, usage: norm(u.cost), usageCount: u.count, net: sub(collected, u.cost) });
  }
  const unmatchedCollected = sumOf([unmatched.recharges, unmatched.core, unmatched.other]);
  const totals = {
    recharges: sumOf([...rows.map((r) => r.recharges), unmatched.recharges]),
    core: sumOf([...rows.map((r) => r.core), unmatched.core]),
    other: sumOf([...rows.map((r) => r.other), unmatched.other]),
    collected: sumOf([...rows.map((r) => r.collected), unmatchedCollected]),
    usage: sumOf(rows.map((r) => r.usage)),
  };
  return { rows, unmatched: { ...unmatched, collected: unmatchedCollected }, totals: { ...totals, net: sub(totals.collected, totals.usage) }, unlistedRevenue };
}

export function sortMemberMargin(rows: MemberMarginRow[], sort: MemberMarginSort, dir: "asc" | "desc", labelOf: (r: MemberMarginRow) => string): MemberMarginRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const c = sort === "label" ? labelOf(a).toLowerCase().localeCompare(labelOf(b).toLowerCase()) : cmp(a[sort], b[sort]);
    return c * sign || a.accountId.localeCompare(b.accountId);
  });
}

