import type { BillingClass, PrismaClient } from "@prisma/client";
import { denverMonthOf, monthRangeBounds, monthsBetween } from "./denver";
import { byTimeDescIdDesc, decodeCursor, pageOf, type Cursor, type Page } from "./evidence";
import { add, ZERO, sub, sumOf, type Money } from "./money";

/**
 * REVENUE RULE (single definition; page, drill-down and CSV all use it):
 *   net = amount − amountRefunded, over ledger rows with status IN (succeeded, refunded),
 *   excluding classes trial_auth and failed_signup (those are "attempts"), bucketed by the Denver month of occurredAt.
 *   Refunds are attributed to the ORIGINAL transaction's month. A fully refunded row nets to zero.
 */
export const REVENUE_STATUSES = ["succeeded", "refunded"] as const;
export const ATTEMPT_ONLY_CLASSES: BillingClass[] = ["trial_auth", "failed_signup"];
export const REVENUE_CLASS_KEYS = ["core_subscription", "wallet_auto_recharge", "wallet_manual_recharge", "other"] as const;
export type RevenueClassKey = (typeof REVENUE_CLASS_KEYS)[number];
export const CLASS_LABEL: Record<RevenueClassKey, string> = {
  core_subscription: "Core subscription",
  wallet_auto_recharge: "Wallet auto-recharge",
  wallet_manual_recharge: "Wallet manual recharge",
  other: "Other / unclassified",
};

export type LedgerRow = {
  ghlTransactionId: string;
  occurredAt: Date;
  classification: BillingClass;
  status: string;
  amount: Money;
  amountRefunded: Money;
  provider: string;
  ghlAccountId: string | null;
  refundDetectedAt: Date | null;
  subscriptionId: string | null;
  classifierVersion: number;
};

/** "GHL processor: stripe" — the processor GHL settles through; unrelated to the REItools Stripe integration. */
export const providerLabel = (p: string | null | undefined): string => `GHL processor: ${p || "unknown"}`;

// ── the one fetch ───────────────────────────────────────────────────────────

export type LedgerScope = { fromMonth?: string; toMonth?: string; accountId?: string | "unmatched" };

/** Every ledger row in scope (any status/class). Small table; all report rules are applied as pure functions over this. */
export async function fetchLedgerRows(db: PrismaClient, scope: LedgerScope): Promise<LedgerRow[]> {
  const where: Record<string, unknown> = {};
  if (scope.fromMonth && scope.toMonth) {
    const b = monthRangeBounds(scope.fromMonth, scope.toMonth);
    where.occurredAt = { gte: b.from, lt: b.to };
  }
  if (scope.accountId === "unmatched") where.ghlAccountId = null;
  else if (scope.accountId) where.ghlAccountId = scope.accountId;
  const rows = await db.billingLedgerEntry.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { ghlTransactionId: "desc" }],
    select: { ghlTransactionId: true, occurredAt: true, classification: true, status: true, amount: true, amountRefunded: true, provider: true, ghlAccountId: true, refundDetectedAt: true, subscriptionId: true, classifierVersion: true },
  });
  return rows.map((r) => ({ ...r, amount: r.amount.toFixed(6), amountRefunded: r.amountRefunded.toFixed(6) }));
}

// ── rules ───────────────────────────────────────────────────────────────────

export const isRevenue = (r: LedgerRow): boolean => (REVENUE_STATUSES as readonly string[]).includes(r.status) && !ATTEMPT_ONLY_CLASSES.includes(r.classification);
export const isAttempt = (r: LedgerRow): boolean => !isRevenue(r);
export const revenueClassOf = (c: BillingClass): RevenueClassKey =>
  c === "core_subscription" || c === "wallet_auto_recharge" || c === "wallet_manual_recharge" ? c : "other";
export const netOf = (r: Pick<LedgerRow, "amount" | "amountRefunded">): Money => sub(r.amount, r.amountRefunded);
export const monthOf = (r: LedgerRow): string => denverMonthOf(r.occurredAt);

// ── aggregate ───────────────────────────────────────────────────────────────

export type ClassCell = { net: Money; count: number };
export type RevenueMonth = { month: string; byClass: Record<RevenueClassKey, ClassCell>; net: Money; count: number; byProvider: Record<string, Money> };
export type RevenueFilters = { fromMonth: string; toMonth: string; month?: string; klass?: RevenueClassKey; provider?: string; accountId?: string | "unmatched" };

const emptyByClass = (): Record<RevenueClassKey, ClassCell> => ({ core_subscription: { net: ZERO, count: 0 }, wallet_auto_recharge: { net: ZERO, count: 0 }, wallet_manual_recharge: { net: ZERO, count: 0 }, other: { net: ZERO, count: 0 } });

function foldInto(m: { byClass: Record<RevenueClassKey, ClassCell>; net: Money; count: number; byProvider: Record<string, Money> }, r: LedgerRow) {
  const n = netOf(r);
  const k = revenueClassOf(r.classification);
  m.byClass[k] = { net: add(m.byClass[k].net, n), count: m.byClass[k].count + 1 };
  m.net = add(m.net, n);
  m.count += 1;
  m.byProvider[r.provider] = add(m.byProvider[r.provider] ?? ZERO, n);
}

/** Pure. Every month in [fromMonth, toMonth] appears, zero-filled. Rows outside the range are ignored. */
export function aggregateRevenue(rows: LedgerRow[], fromMonth: string, toMonth: string): { rows: RevenueMonth[]; totals: Omit<RevenueMonth, "month"> } {
  const months = new Map<string, RevenueMonth>(monthsBetween(fromMonth, toMonth).map((m) => [m, { month: m, byClass: emptyByClass(), net: ZERO, count: 0, byProvider: {} }]));
  const totals = { byClass: emptyByClass(), net: ZERO, count: 0, byProvider: {} as Record<string, Money> };
  for (const r of rows) {
    if (!isRevenue(r)) continue;
    const m = months.get(monthOf(r));
    if (!m) continue;
    foldInto(m, r);
    foldInto(totals, r);
  }
  return { rows: [...months.values()], totals };
}

// ── detail (drill-down) ─────────────────────────────────────────────────────

export type RevenueDetailRow = LedgerRow & { month: string; net: Money; revenueClass: RevenueClassKey };

/** Pure. The exact rows behind an aggregate cell: same rule, narrowed by month / class / provider / account. */
export function revenueDetail(rows: LedgerRow[], f: Pick<RevenueFilters, "fromMonth" | "toMonth" | "month" | "klass" | "provider" | "accountId">): RevenueDetailRow[] {
  return rows
    .filter(isRevenue)
    .map((r) => ({ ...r, month: monthOf(r), net: netOf(r), revenueClass: revenueClassOf(r.classification) }))
    .filter((r) => r.month >= f.fromMonth && r.month <= f.toMonth)
    .filter((r) => (f.month ? r.month === f.month : true) && (f.klass ? r.revenueClass === f.klass : true) && (f.provider ? r.provider === f.provider : true))
    .filter((r) => (f.accountId === "unmatched" ? r.ghlAccountId === null : f.accountId ? r.ghlAccountId === f.accountId : true))
    .sort(byTimeDescIdDesc((r) => ({ t: r.occurredAt.toISOString(), id: r.ghlTransactionId })));
}

/** Text for the refund column: the detection date, "predates tracking" for a refunded row with no timestamp, else "". */
export function refundNote(r: Pick<LedgerRow, "amountRefunded" | "refundDetectedAt">): string {
  if (r.amountRefunded === ZERO || Number(r.amountRefunded) === 0) return "";
  return r.refundDetectedAt ? `detected ${r.refundDetectedAt.toISOString().slice(0, 10)}` : "predates tracking";
}

/** {rows, totals, ids}: aggregate + the ledger ids behind it (ledger is small, so ids are materialized). */
export async function getRevenue(db: PrismaClient, f: RevenueFilters) {
  const ledger = await fetchLedgerRows(db, { fromMonth: f.fromMonth, toMonth: f.toMonth, accountId: f.accountId });
  return revenueFromRows(ledger, f);
}

export function revenueFromRows(ledger: LedgerRow[], f: RevenueFilters) {
  const agg = aggregateRevenue(f.accountId ? ledger.filter((r) => (f.accountId === "unmatched" ? r.ghlAccountId === null : r.ghlAccountId === f.accountId)) : ledger, f.fromMonth, f.toMonth);
  const ids = revenueDetail(ledger, f).map((r) => r.ghlTransactionId);
  return { ...agg, ids };
}

export function revenueDetailPage(ledger: LedgerRow[], f: RevenueFilters, cursor: string | null): Page<RevenueDetailRow> {
  return pageOf(revenueDetail(ledger, f), (r): Cursor => ({ t: r.occurredAt.toISOString(), id: r.ghlTransactionId }), decodeCursor(cursor));
}

// ── attempts (everything NOT counted as revenue) ────────────────────────────

export type AttemptCell = { classification: BillingClass; status: string; count: number; amount: Money };
export type AttemptFilters = { fromMonth: string; toMonth: string; month?: string; classification?: BillingClass; status?: string };

/** Pure. By class × status: rows that are not revenue (failed/pending/…, trial_auth, failed_signup). `amount` is the gross attempted amount. */
export function aggregateAttempts(rows: LedgerRow[], f: Pick<AttemptFilters, "fromMonth" | "toMonth">): { rows: AttemptCell[]; totals: { count: number; amount: Money }; ids: string[] } {
  const cells = new Map<string, AttemptCell>();
  const ids: string[] = [];
  for (const r of rows) {
    if (!isAttempt(r)) continue;
    const m = monthOf(r);
    if (m < f.fromMonth || m > f.toMonth) continue;
    const key = `${r.classification}|${r.status}`;
    const c = cells.get(key) ?? { classification: r.classification, status: r.status, count: 0, amount: ZERO };
    c.count += 1;
    c.amount = add(c.amount, r.amount);
    cells.set(key, c);
    ids.push(r.ghlTransactionId);
  }
  const list = [...cells.values()].sort((a, b) => a.classification.localeCompare(b.classification) || a.status.localeCompare(b.status));
  return { rows: list, totals: { count: list.reduce((n, c) => n + c.count, 0), amount: sumOf(list.map((c) => c.amount)) }, ids };
}

export function attemptsDetail(rows: LedgerRow[], f: AttemptFilters): LedgerRow[] {
  return rows
    .filter(isAttempt)
    .filter((r) => { const m = monthOf(r); return m >= f.fromMonth && m <= f.toMonth && (f.month ? m === f.month : true); })
    .filter((r) => (f.classification ? r.classification === f.classification : true) && (f.status ? r.status === f.status : true))
    .sort(byTimeDescIdDesc((r) => ({ t: r.occurredAt.toISOString(), id: r.ghlTransactionId })));
}

// ── processor eras (whole ledger, independent of the page filter) ───────────

/** First/last transaction date and row count per provider across the WHOLE ledger. */
export async function fetchEras(db: PrismaClient): Promise<Era[]> {
  const g = await db.billingLedgerEntry.groupBy({ by: ["provider"], _min: { occurredAt: true }, _max: { occurredAt: true }, _count: { _all: true } });
  return g
    .map((x) => ({ provider: x.provider, label: providerLabel(x.provider), first: x._min.occurredAt as Date, last: x._max.occurredAt as Date, count: x._count._all }))
    .sort((a, b) => a.first.getTime() - b.first.getTime());
}


export type Era = { provider: string; label: string; first: Date; last: Date; count: number };

export function computeEras(rows: Pick<LedgerRow, "provider" | "occurredAt">[]): Era[] {
  const by = new Map<string, Era>();
  for (const r of rows) {
    const e = by.get(r.provider);
    if (!e) by.set(r.provider, { provider: r.provider, label: providerLabel(r.provider), first: r.occurredAt, last: r.occurredAt, count: 1 });
    else {
      e.count += 1;
      if (r.occurredAt < e.first) e.first = r.occurredAt;
      if (r.occurredAt > e.last) e.last = r.occurredAt;
    }
  }
  return [...by.values()].sort((a, b) => a.first.getTime() - b.first.getTime());
}

/** Months (within the given list) in which a provider had revenue rows — used to mark eras on the monthly table/chart. */
export const eraMonths = (m: RevenueMonth): string[] => Object.entries(m.byProvider).filter(([, v]) => Number(v) !== 0).map(([p]) => p).sort();

