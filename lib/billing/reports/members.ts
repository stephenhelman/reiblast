import type { BillingState, PauseReason, PrismaClient } from "@prisma/client";
import { usageSince, costCells, summarizeCosts, type CostFilters } from "./costs";
import { monthsBetween } from "./denver";
import { ZERO, add, cmp, sub, sumOf, type Money } from "./money";
import { fetchLedgerRows, isRevenue, netOf, revenueClassOf, monthOf, type LedgerRow } from "./revenue";

export type BalanceSnap = { status: string; balance: Money | null; takenOn: string };

export type MemberFacts = {
  accountId: string;
  locationId: string | null;
  locationName: string | null;
  businessName: string | null;
  billingState: BillingState | null;
  pauseReason: PauseReason | null;
  legacyUnreconciled: boolean;
  /** User.warningCount — the live (pre-cutover) strike count. */
  strikes: number;
  trialOffer: string | null;
  trialEndsAt: Date | null;
  coveredUntil: Date | null;
  coverageNote: string | null;
  balance: BalanceSnap | null;
  lastCorePaymentAt: Date | null;
  usage30: Money;
  recharges30: Money;
};

export type MemberRow = MemberFacts & {
  /** ≈ last succeeded core payment + 1 month. An ESTIMATE, not a billing date. */
  expectedNextCharge: Date | null;
  /** coveredUntil is set and later than the estimate (or there is no estimate): the manual override is what applies. */
  coverageOverrideApplies: boolean;
};

/** Calendar-month add on a UTC instant, clamping the day (Jan 31 → Feb 28/29). */
export function addOneMonth(d: Date): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 1, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

export function withEstimates(f: MemberFacts): MemberRow {
  const expectedNextCharge = f.lastCorePaymentAt ? addOneMonth(f.lastCorePaymentAt) : null;
  const coverageOverrideApplies = !!f.coveredUntil && (!expectedNextCharge || f.coveredUntil.getTime() > expectedNextCharge.getTime());
  return { ...f, expectedNextCharge, coverageOverrideApplies };
}

export const STATE_FILTERS = ["all", "trial", "active", "payment_failed", "paused", "inactive", "churned", "not_seeded"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
export const MEMBER_SORTS = ["label", "state", "balance", "lastCore", "usage30", "recharges30", "strikes", "covered"] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export const matchesState = (r: Pick<MemberFacts, "billingState">, s: StateFilter): boolean => (s === "all" ? true : s === "not_seeded" ? r.billingState === null : r.billingState === s);

const time = (d: Date | null): number => (d ? d.getTime() : -Infinity);

export function sortMembers(rows: MemberRow[], sort: MemberSort, dir: "asc" | "desc", labelOf: (r: MemberRow) => string): MemberRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const key = (a: MemberRow, b: MemberRow): number => {
    switch (sort) {
      case "label": return labelOf(a).toLowerCase().localeCompare(labelOf(b).toLowerCase());
      case "state": return String(a.billingState ?? "~").localeCompare(String(b.billingState ?? "~"));
      case "balance": return cmp(a.balance?.balance ?? "-999999999", b.balance?.balance ?? "-999999999");
      case "lastCore": return time(a.lastCorePaymentAt) - time(b.lastCorePaymentAt);
      case "covered": return time(a.coveredUntil) - time(b.coveredUntil);
      case "usage30": return cmp(a.usage30, b.usage30);
      case "recharges30": return cmp(a.recharges30, b.recharges30);
      case "strikes": return a.strikes - b.strikes;
    }
  };
  return [...rows].sort((a, b) => key(a, b) * sign || a.accountId.localeCompare(b.accountId));
}

// ── loading ─────────────────────────────────────────────────────────────────

/** Latest snapshot per location. */
export async function latestSnapshots(db: Pick<PrismaClient, "$queryRaw">): Promise<Map<string, BalanceSnap>> {
  const rows = await db.$queryRaw<{ locationId: string; takenOn: Date; status: string; balance: { toString(): string } | null }[]>`
    SELECT DISTINCT ON ("locationId") "locationId", "takenOn", "status", "balance" FROM "WalletBalanceSnapshot" ORDER BY "locationId", "takenOn" DESC`;
  return new Map(rows.map((r) => [r.locationId, { status: r.status, balance: r.balance === null ? null : r.balance.toString(), takenOn: r.takenOn.toISOString().slice(0, 10) }]));
}

/** Pure: net recharges (auto + manual, revenue rule) per account within [since, ∞). */
export function rechargesSince(ledger: LedgerRow[], since: Date): Map<string, Money> {
  const out = new Map<string, Money>();
  for (const r of ledger) {
    if (!isRevenue(r) || !r.ghlAccountId || r.occurredAt < since) continue;
    const k = revenueClassOf(r.classification);
    if (k !== "wallet_auto_recharge" && k !== "wallet_manual_recharge") continue;
    out.set(r.ghlAccountId, add(out.get(r.ghlAccountId) ?? ZERO, netOf(r)));
  }
  return out;
}

/** Pure: latest succeeded core_subscription per account. */
export function lastCorePayments(ledger: LedgerRow[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const r of ledger) {
    if (r.classification !== "core_subscription" || r.status !== "succeeded" || !r.ghlAccountId) continue;
    const cur = out.get(r.ghlAccountId);
    if (!cur || r.occurredAt > cur) out.set(r.ghlAccountId, r.occurredAt);
  }
  return out;
}

export async function loadMembers(db: PrismaClient, hq: string | null | undefined, now = new Date()): Promise<{ rows: MemberRow[] }> {
  const since = new Date(now.getTime() - 30 * 864e5);
  const [accounts, snaps, ledger, usage] = await Promise.all([
    db.ghlAccount.findMany({
      where: { accountType: "member" },
      select: { id: true, locationId: true, locationName: true, billingState: true, pauseReason: true, legacyUnreconciled: true, trialOffer: true, trialEndsAt: true, coreCoveredUntil: true, coreCoverageNote: true, user: { select: { businessName: true, warningCount: true } } },
    }),
    latestSnapshots(db),
    fetchLedgerRows(db, {}),
    usageSince(db, since, hq),
  ]);
  const memberIds = new Set(accounts.map((a) => a.id));
  const scoped = ledger.filter((r) => r.ghlAccountId && memberIds.has(r.ghlAccountId));
  const lastCore = lastCorePayments(scoped);
  const recharges = rechargesSince(scoped, since);
  const rows = accounts.map((a) =>
    withEstimates({
      accountId: a.id,
      locationId: a.locationId,
      locationName: a.locationName,
      businessName: a.user?.businessName ?? null,
      billingState: a.billingState,
      pauseReason: a.pauseReason,
      legacyUnreconciled: a.legacyUnreconciled,
      strikes: a.user?.warningCount ?? 0,
      trialOffer: a.trialOffer,
      trialEndsAt: a.trialEndsAt,
      coveredUntil: a.coreCoveredUntil,
      coverageNote: a.coreCoverageNote,
      balance: a.locationId ? (snaps.get(a.locationId) ?? null) : null,
      lastCorePaymentAt: lastCore.get(a.id) ?? null,
      usage30: (a.locationId ? usage.get(a.locationId)?.cost : undefined) ?? ZERO,
      recharges30: recharges.get(a.id) ?? ZERO,
    }),
  );
  return { rows };
}

// ── member detail ───────────────────────────────────────────────────────────

/** Pure: per-month revenue (revenue rule) vs usage charged, for the small chart on the member page. */
export function revenueVsUsage(ledger: LedgerRow[], usageByMonth: Map<string, Money>, fromMonth: string, toMonth: string) {
  return monthsBetween(fromMonth, toMonth).map((month) => {
    const revenue = sumOf(ledger.filter((r) => isRevenue(r) && monthOf(r) === month).map(netOf));
    const usage = usageByMonth.get(month) ?? ZERO;
    return { month, revenue, usage, net: sub(revenue, usage) };
  });
}

export async function getMemberDetail(db: PrismaClient, accountId: string, range: { fromMonth: string; toMonth: string }, hq: string | null | undefined, now = new Date()) {
  const { rows } = await loadMembers(db, hq, now);
  const member = rows.find((r) => r.accountId === accountId) ?? null;
  if (!member) return null;
  const ledger = await fetchLedgerRows(db, { accountId });
  const filters: CostFilters = { ...range, scopeKey: member.locationId ?? "__none__" };
  const cells = member.locationId ? await costCells(db, filters, hq) : [];
  const usageByMonth = new Map<string, Money>();
  for (const c of cells) usageByMonth.set(c.month, add(usageByMonth.get(c.month) ?? ZERO, sub(ZERO, c.stored)));
  const snapshots = member.locationId
    ? await db.walletBalanceSnapshot.findMany({ where: { locationId: member.locationId }, orderBy: { takenOn: "desc" }, take: 90, select: { takenOn: true, status: true, balance: true } })
    : [];
  return {
    member,
    ledger,
    monthlyCategories: { cells, ...summarizeCosts(cells) },
    chart: revenueVsUsage(ledger, usageByMonth, range.fromMonth, range.toMonth),
    snapshots: snapshots.map((s) => ({ takenOn: s.takenOn.toISOString().slice(0, 10), status: s.status, balance: s.balance === null ? null : s.balance.toFixed(6) })),
  };
}

