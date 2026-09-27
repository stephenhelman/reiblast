import type { BillingClass } from "@prisma/client";
import { addMonths, currentDenverMonth, isMonth } from "@/lib/billing/reports/denver";
import { COST_GROUPS, SCOPE_CLASSES, type CostFilters, type CostGroup, type ScopeClass } from "@/lib/billing/reports/costs";
import { MEMBER_SORTS, STATE_FILTERS, type MemberSort, type StateFilter } from "@/lib/billing/reports/members";
import { MEMBER_MARGIN_SORTS, type MemberMarginSort } from "@/lib/billing/reports/margin";
import { REVENUE_CLASS_KEYS, type AttemptFilters, type RevenueClassKey, type RevenueFilters } from "@/lib/billing/reports/revenue";

/** Query-string parsing shared by the pages and /api/admin/export — so a page and its CSV always use the same filters. */
export type Params = { get(name: string): string | null };

/** First month with data (June 2026). Ranges never start earlier; the default window is the last 6 months. */
export const DATA_START = "2026-06";
const MAX_MONTHS = 36;

/** Adapts Next's `searchParams` object to Params. */
export const paramsOf = (sp: Record<string, string | string[] | undefined>): Params => ({ get: (k) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? null; } });

const enumOf = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const idOf = (v: string | null): string | undefined => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);

export function parseRange(p: Params, now = new Date()): { fromMonth: string; toMonth: string } {
  const cur = currentDenverMonth(now);
  let to = p.get("to");
  let from = p.get("from");
  const toMonth = isMonth(to) ? (to > cur ? cur : to) : cur;
  let fromMonth = isMonth(from) ? from : addMonths(toMonth, -5);
  if (fromMonth < DATA_START) fromMonth = DATA_START;
  if (fromMonth > toMonth) fromMonth = toMonth;
  if (addMonths(fromMonth, MAX_MONTHS) <= toMonth) fromMonth = addMonths(toMonth, -(MAX_MONTHS - 1));
  return { fromMonth, toMonth };
}

const monthParam = (p: Params): string | undefined => { const m = p.get("month"); return isMonth(m) ? m : undefined; };

export function parseRevenueFilters(p: Params, now = new Date()): RevenueFilters {
  const provider = p.get("provider");
  const acct = p.get("account");
  return {
    ...parseRange(p, now),
    month: monthParam(p),
    klass: enumOf<RevenueClassKey>(p.get("class"), REVENUE_CLASS_KEYS),
    provider: provider && /^[A-Za-z0-9_.-]{1,40}$/.test(provider) ? provider : undefined,
    accountId: acct === "unmatched" ? "unmatched" : idOf(acct),
  };
}

const BILLING_CLASSES: BillingClass[] = ["core_subscription", "wallet_auto_recharge", "wallet_manual_recharge", "trial_auth", "failed_signup", "refund", "unclassified"];
export function parseAttemptFilters(p: Params, now = new Date()): AttemptFilters {
  const status = p.get("status");
  return { ...parseRange(p, now), month: monthParam(p), classification: enumOf<BillingClass>(p.get("classification"), BILLING_CLASSES), status: status && /^[a-z_]{1,24}$/.test(status) ? status : undefined };
}

export function parseCostFilters(p: Params, now = new Date()): CostFilters {
  const category = p.get("category");
  return {
    ...parseRange(p, now),
    month: monthParam(p),
    scope: enumOf<ScopeClass>(p.get("scope"), SCOPE_CLASSES),
    group: enumOf<CostGroup>(p.get("group"), COST_GROUPS),
    category: category && /^[a-z0-9_]{1,48}$/.test(category) ? category : undefined,
    scopeKey: idOf(p.get("scopeKey")),
  };
}

export type SortDir = "asc" | "desc";
export const parseDir = (p: Params, fallback: SortDir): SortDir => enumOf<SortDir>(p.get("dir"), ["asc", "desc"]) ?? fallback;
export const parseMemberFilters = (p: Params): { state: StateFilter; sort: MemberSort; dir: SortDir } => ({ state: enumOf(p.get("state"), STATE_FILTERS) ?? "all", sort: enumOf(p.get("sort"), MEMBER_SORTS) ?? "label", dir: parseDir(p, "asc") });
export const parseMarginSort = (p: Params): { sort: MemberMarginSort; dir: SortDir } => ({ sort: enumOf(p.get("sort"), MEMBER_MARGIN_SORTS) ?? "net", dir: parseDir(p, "desc") });
export const parseCursor = (p: Params): string | null => { const c = p.get("after"); return c && /^[A-Za-z0-9_-]{1,300}$/.test(c) ? c : null; };
export const parseMemberId = (p: Params): string | undefined => idOf(p.get("member"));

/** Only the filters that are set, for links, CSV metadata and audit detail. */
export const definedOnly = (o: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));
