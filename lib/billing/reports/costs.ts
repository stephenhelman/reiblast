import { Prisma } from "@prisma/client";
import { monthRangeBounds, sqlDenverMonth } from "./denver";
import { decodeCursor, walletChunks, walletPage, type SqlDb, type WalletRow, type Page } from "./evidence";
import { add, neg, sumOf, ZERO, type Money } from "./money";

/**
 * COSTS come from WalletTransaction (the row-level evidence behind UsageRollup), bucketed by the Denver month of
 * settlementTime. Amounts are signed as stored (charges negative, recharges positive); the aggregate views DISPLAY costs
 * as positive numbers via costDisplay(). Aggregate and detail share ONE filter (costWhere), so they cannot disagree.
 */
export const ONE_TIME_CATEGORIES = ["a2p_registration", "a2p_fast_track", "domain_purchase", "caller_id_verification"] as const;
export const AGENCY_CASH_CATEGORIES = ["agency_auto_recharge", "agency_manual_recharge"] as const;
export const TAX_CATEGORIES = ["wallet_sales_tax"] as const;

export type CostGroup = "one_time" | "ongoing" | "agency_cash" | "tax";
export const COST_GROUPS: CostGroup[] = ["one_time", "ongoing", "agency_cash", "tax"];
export const GROUP_LABEL: Record<CostGroup, string> = { one_time: "One-time", ongoing: "Ongoing usage", agency_cash: "Agency cash paid to GHL", tax: "Taxes" };

export type ScopeClass = "member" | "hq" | "agency" | "unattributed";
export const SCOPE_CLASSES: ScopeClass[] = ["member", "hq", "agency", "unattributed"];
export const SCOPE_LABEL: Record<ScopeClass, string> = { member: "Members", hq: "REIblast HQ", agency: "Agency (GHL wallet)", unattributed: "Unattributed" };

export function costGroupOf(category: string): CostGroup {
  if ((ONE_TIME_CATEGORIES as readonly string[]).includes(category)) return "one_time";
  if ((AGENCY_CASH_CATEGORIES as readonly string[]).includes(category)) return "agency_cash";
  if ((TAX_CATEGORIES as readonly string[]).includes(category)) return "tax";
  return "ongoing";
}

/** Scope class of a wallet scopeKey (pure mirror of the SQL CASE below). */
export function scopeClassOf(scopeKey: string, hq: string | null | undefined): ScopeClass {
  if (scopeKey === "_agency") return "agency";
  if (scopeKey === "_unattributed") return "unattributed";
  return hq && scopeKey === hq ? "hq" : "member";
}

/** Display sign: costs (one-time, ongoing, tax) are shown positive; agency cash paid is already positive. */
export const costDisplay = (group: CostGroup, stored: Money): Money => (group === "agency_cash" ? stored : neg(stored));

export type CostFilters = {
  fromMonth: string;
  toMonth: string;
  /** A single Denver month; narrows the range (drill-downs, raw exports). */
  month?: string;
  scope?: ScopeClass;
  group?: CostGroup;
  category?: string;
  /** Exact wallet scopeKey (a member's locationId). */
  scopeKey?: string;
};

const list = (xs: readonly string[]) => Prisma.join(xs as string[]);
const scopeCase = (hq: string | null | undefined) =>
  Prisma.sql`(CASE WHEN "scopeKey" = ${hq ?? ""} AND ${hq ? 1 : 0} = 1 THEN 'hq' WHEN "scopeKey" = '_agency' THEN 'agency' WHEN "scopeKey" = '_unattributed' THEN 'unattributed' ELSE 'member' END)`;

/** THE filter. Used by the aggregate, the drill-down page and the CSV export. */
export function costWhere(f: CostFilters, hq: string | null | undefined): Prisma.Sql {
  const b = f.month ? monthRangeBounds(f.month, f.month) : monthRangeBounds(f.fromMonth, f.toMonth);
  const c: Prisma.Sql[] = [Prisma.sql`"settlementTime" >= ${b.from.toISOString()}::timestamp AND "settlementTime" < ${b.to.toISOString()}::timestamp`];
  if (f.scope) c.push(Prisma.sql`${scopeCase(hq)} = ${f.scope}`);
  if (f.scopeKey) c.push(Prisma.sql`"scopeKey" = ${f.scopeKey}`);
  if (f.category) c.push(Prisma.sql`"category" = ${f.category}`);
  if (f.group === "one_time") c.push(Prisma.sql`"category" IN (${list(ONE_TIME_CATEGORIES)})`);
  else if (f.group === "agency_cash") c.push(Prisma.sql`"category" IN (${list(AGENCY_CASH_CATEGORIES)})`);
  else if (f.group === "tax") c.push(Prisma.sql`"category" IN (${list(TAX_CATEGORIES)})`);
  else if (f.group === "ongoing") c.push(Prisma.sql`"category" NOT IN (${list([...ONE_TIME_CATEGORIES, ...AGENCY_CASH_CATEGORIES, ...TAX_CATEGORIES])})`);
  return Prisma.join(c, " AND ");
}

export type CostCell = { month: string; scope: ScopeClass; category: string; group: CostGroup; count: number; stored: Money; display: Money };

export async function costCells(db: SqlDb, f: CostFilters, hq: string | null | undefined): Promise<CostCell[]> {
  const rows = await db.$queryRaw<{ month: string; scope: ScopeClass; category: string; n: number; s: string }[]>`
    SELECT ${Prisma.raw(sqlDenverMonth('"settlementTime"'))} AS "month", ${scopeCase(hq)} AS "scope", "category", COUNT(*)::int AS "n", SUM("amount")::text AS "s"
    FROM "WalletTransaction" WHERE ${costWhere(f, hq)}
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
  return rows.map((r) => {
    const group = costGroupOf(r.category);
    const stored = add(r.s, ZERO);
    return { month: r.month, scope: r.scope, category: r.category, group, count: r.n, stored, display: costDisplay(group, stored) };
  });
}

export type CostTotals = { byGroup: Record<CostGroup, Money>; count: number };

/** Pure. Group × scope × month views over the cells. */
export function summarizeCosts(cells: CostCell[]) {
  const sumGroup = (pred: (c: CostCell) => boolean): Record<CostGroup, Money> =>
    Object.fromEntries(COST_GROUPS.map((g) => [g, sumOf(cells.filter((c) => pred(c) && c.group === g).map((c) => c.display))])) as Record<CostGroup, Money>;
  const months = [...new Set(cells.map((c) => c.month))].sort();
  return {
    byMonth: months.map((month) => ({ month, byGroup: sumGroup((c) => c.month === month), byScope: Object.fromEntries(SCOPE_CLASSES.map((s) => [s, sumGroup((c) => c.month === month && c.scope === s)])) as Record<ScopeClass, Record<CostGroup, Money>> })),
    byScope: Object.fromEntries(SCOPE_CLASSES.map((s) => [s, sumGroup((c) => c.scope === s)])) as Record<ScopeClass, Record<CostGroup, Money>>,
    totals: { byGroup: sumGroup(() => true), count: cells.reduce((n, c) => n + c.count, 0) } as CostTotals,
  };
}

export async function getCosts(db: SqlDb, f: CostFilters, hq: string | null | undefined) {
  const rows = await costCells(db, f, hq);
  return { rows, ...summarizeCosts(rows), where: costWhere(f, hq) }; // `where` selects the underlying WalletTransaction rows (the ids)
}

/** Drill-down page of raw wallet transactions for a filter (newest first, keyset). */
export const costDetailPage = (db: SqlDb, f: CostFilters, hq: string | null | undefined, cursor: string | null): Promise<Page<WalletRow>> => walletPage(db, costWhere(f, hq), decodeCursor(cursor));
export const costDetailChunks = (db: SqlDb, f: CostFilters, hq: string | null | undefined): AsyncGenerator<WalletRow[]> => walletChunks(db, costWhere(f, hq));

/** Member-scope charges per wallet scope over the filter's range, shown positive (usage charged). One query, used by margin and members. */
export async function usageByScope(db: SqlDb, f: Pick<CostFilters, "fromMonth" | "toMonth" | "month">, hq: string | null | undefined): Promise<Map<string, { cost: Money; count: number }>> {
  const rows = await db.$queryRaw<{ scopeKey: string; s: string; n: number }[]>`
    SELECT "scopeKey", SUM("amount")::text AS "s", COUNT(*)::int AS "n" FROM "WalletTransaction"
    WHERE ${costWhere({ ...f, scope: "member" }, hq)} GROUP BY 1`;
  return new Map(rows.map((r) => [r.scopeKey, { cost: neg(r.s), count: r.n }]));
}

/** Same, for a rolling window starting at `since` (members list "30-day usage"). */
export async function usageSince(db: SqlDb, since: Date, hq: string | null | undefined): Promise<Map<string, { cost: Money; count: number }>> {
  const rows = await db.$queryRaw<{ scopeKey: string; s: string; n: number }[]>`
    SELECT "scopeKey", SUM("amount")::text AS "s", COUNT(*)::int AS "n" FROM "WalletTransaction"
    WHERE "settlementTime" >= ${since.toISOString()}::timestamp AND ${scopeCase(hq)} = 'member' GROUP BY 1`;
  return new Map(rows.map((r) => [r.scopeKey, { cost: neg(r.s), count: r.n }]));
}

/** Raw-transaction exports/drill-downs must be a single Denver month. */
export const requiresMonth = (f: Pick<CostFilters, "month">): boolean => !f.month;
