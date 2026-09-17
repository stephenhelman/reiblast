// Admin-eyes overview data layer (/admin). Aggregate operator view: usage,
// vendor cost, margin. Read-only — v1 writes nothing.
//
// AUDIENCE SPLIT (locked, see prisma/schema.prisma ApiCall/LedgerEntry
// comments): this file reads ToolUse + ApiCall (admin-eyes: usage + company
// cost). It never reads LedgerEntry for cost — LedgerEntry is client-eyes
// only and carries no company cost.
//
// Default view EXCLUDES isAdmin runs (both ToolUse and ApiCall carry the
// flag independently — filter both, since a run's ApiCalls are what actually
// carries the cost). Callers pass includeAdmin to flip that.

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export type ToolSlug = "score" | "ask" | "bots" | "scrub" | "pack";

export type UsagePoint = { date: string; count: number };

export type ToolUsageSummary = {
  featureSlug: string;
  totalRuns: number;
  success: number;
  fail: number;
  partial: number;
  series: UsagePoint[]; // per-day run counts over the window
};

export type ToolVendorCost = {
  featureSlug: string;
  vendorCostCents: number; // frozen ApiCall.costCents sum, non-Rentcast
  rentcastCostCents: number; // period-allocated share attributed to this tool's rentcast calls
  totalCostCents: number;
  revenueCents: number; // estimated (list price) — see RevenueByTool
  marginCents: number;
  failCostCents: number; // cost burned on fail-outcome runs — surfaced so margin doesn't hide it
};

export type RentcastPanel = {
  periodStart: string;
  periodEnd: string;
  periodCalls: number;
  includedQuota: number;
  baseMonthlyCents: number;
  overageCentsPerCall: number;
  totalPeriodCostCents: number; // baseMonthlyCents + overage so far
  costPerCallCents: number; // totalPeriodCostCents / periodCalls — decreases as periodCalls grows
  isOpenPeriod: boolean; // true until the vendor period closes — cost-per-call is an in-progress estimate
  approachingUpgradeTrigger: boolean; // trending toward the ~3000 sustained-calls trigger
  trend: { date: string; cumulativeCalls: number }[];
};

export type CacheEffectiveness = {
  freshCostCents: number; // avg cost per fresh (3-ApiCall) Score run
  cacheCostCents: number; // avg cost per cache (1-ApiCall) Score run
  gapCents: number;
  freshCount: number;
  cacheCount: number;
};

export type AdminOverview = {
  includeAdmin: boolean;
  windowDays: number;
  totalRuns: number;
  totalVendorCostCents: number;
  estMarginCents: number;
  activeMembers: number;
  usage: ToolUsageSummary[];
  vendorCostByTool: ToolVendorCost[];
  rentcast: RentcastPanel;
  cacheEffectiveness: CacheEffectiveness;
}

const WINDOW_DAYS = 45;
const ACTIVE_MEMBER_WINDOW_DAYS = 30;
const RENTCAST_UPGRADE_TRIGGER = 3000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Current Rentcast billing period, anchored on VendorPlan.periodAnchorDay. */
function currentVendorPeriod(now: Date, anchorDay: number): { periodStart: Date; periodEnd: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  let periodStart: Date;
  if (day >= anchorDay) {
    periodStart = new Date(Date.UTC(year, month, anchorDay));
  } else {
    periodStart = new Date(Date.UTC(year, month - 1, anchorDay));
  }
  const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, anchorDay));
  return { periodStart, periodEnd };
}

export async function getAdminOverview(includeAdmin: boolean, db: PrismaClient = defaultPrisma): Promise<AdminOverview> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const activeMemberWindowStart = new Date(now.getTime() - ACTIVE_MEMBER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const adminFilter = includeAdmin ? {} : { isAdmin: false };

  const [toolUses, apiCalls, vendorPlan, activeMembersRows, subs] = await Promise.all([
    db.toolUse.findMany({
      where: { createdAt: { gte: windowStart }, ...adminFilter },
      select: { id: true, featureSlug: true, outcome: true, createdAt: true, compSource: true, isAdmin: true },
    }),
    db.apiCall.findMany({
      where: { createdAt: { gte: windowStart }, ...adminFilter },
      select: {
        id: true,
        toolUseId: true,
        resource: true,
        model: true,
        featureSlug: true,
        costCents: true,
        createdAt: true,
        isAdmin: true,
      },
    }),
    db.vendorPlan.findFirst({ where: { resource: "rentcast" } }),
    db.toolUse.findMany({
      where: { createdAt: { gte: activeMemberWindowStart }, isAdmin: false },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.subscription.findMany({
      where: { status: "active" },
      select: { featureId: true, feature: { select: { slug: true } }, tier: { select: { priceCents: true } } },
    }),
  ]);

  // --- Usage per tool -------------------------------------------------------
  const featureSlugs = Array.from(new Set(toolUses.map((t) => t.featureSlug))).sort();
  const usage: ToolUsageSummary[] = featureSlugs.map((featureSlug) => {
    const runs = toolUses.filter((t) => t.featureSlug === featureSlug);
    const byDay = new Map<string, number>();
    for (const r of runs) {
      const k = dayKey(r.createdAt);
      byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
    const series: UsagePoint[] = Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, count]) => ({ date, count }));

    return {
      featureSlug,
      totalRuns: runs.length,
      success: runs.filter((r) => r.outcome === "success").length,
      fail: runs.filter((r) => r.outcome === "fail").length,
      partial: runs.filter((r) => r.outcome === "partial").length,
      series,
    };
  });

  // --- Rentcast: period-allocated amortized cost -----------------------------
  const anchorDay = vendorPlan?.periodAnchorDay ?? 1;
  const { periodStart, periodEnd } = currentVendorPeriod(now, anchorDay);
  const isOpenPeriod = now < periodEnd;

  // Rentcast calls THIS PERIOD (not just the 45-day usage window) — the plan
  // amortizes over the vendor's own billing period, which may be longer or
  // shorter than the dashboard's usage window.
  const periodRentcastCalls = await db.apiCall.count({
    where: { resource: "rentcast", createdAt: { gte: periodStart, lt: periodEnd }, ...adminFilter },
  });

  const baseMonthlyCents = vendorPlan?.baseMonthlyCents ?? 0;
  const includedQuota = vendorPlan?.includedQuota ?? 0;
  const overageCentsPerCall = vendorPlan?.overageCentsPerCall ?? 0;
  const overageCalls = Math.max(0, periodRentcastCalls - includedQuota);
  const totalPeriodCostCents = baseMonthlyCents + overageCalls * overageCentsPerCall;
  const costPerCallCents = periodRentcastCalls > 0 ? totalPeriodCostCents / periodRentcastCalls : 0;

  // Cumulative-calls trend across the window, for "approaching quota" context.
  const rentcastCallsInWindow = apiCalls.filter((c) => c.resource === "rentcast");
  const rcByDay = new Map<string, number>();
  for (const c of rentcastCallsInWindow) {
    const k = dayKey(c.createdAt);
    rcByDay.set(k, (rcByDay.get(k) ?? 0) + 1);
  }
  let cumulative = 0;
  const trend = Array.from(rcByDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => {
      cumulative += count;
      return { date, cumulativeCalls: cumulative };
    });

  // Sustained-volume trigger: projected monthly run-rate from this period so far.
  const daysElapsedInPeriod = Math.max(1, Math.ceil((now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
  const daysInPeriod = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
  const projectedMonthlyCalls = (periodRentcastCalls / daysElapsedInPeriod) * daysInPeriod;

  const rentcast: RentcastPanel = {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    periodCalls: periodRentcastCalls,
    includedQuota,
    baseMonthlyCents,
    overageCentsPerCall,
    totalPeriodCostCents,
    costPerCallCents,
    isOpenPeriod,
    approachingUpgradeTrigger: projectedMonthlyCalls >= RENTCAST_UPGRADE_TRIGGER * 0.8,
    trend,
  };

  // Per-tool Rentcast allocation: split the period's total Rentcast cost
  // across tools by each tool's share of THIS WINDOW's Rentcast call volume
  // (Rentcast is only ever called by Score's fresh path today, but this
  // stays generic rather than hardcoding "score").
  const rentcastByFeature = new Map<string, number>();
  for (const c of rentcastCallsInWindow) {
    const slug = c.featureSlug ?? "unknown";
    rentcastByFeature.set(slug, (rentcastByFeature.get(slug) ?? 0) + 1);
  }
  const totalWindowRentcastCalls = rentcastCallsInWindow.length;

  // --- Vendor cost + margin per tool -----------------------------------------
  const revenueByFeatureSlug = new Map<string, number>();
  for (const s of subs) {
    const slug = s.feature.slug;
    revenueByFeatureSlug.set(slug, (revenueByFeatureSlug.get(slug) ?? 0) + s.tier.priceCents);
  }

  const toolUseOutcomeById = new Map(toolUses.map((t) => [t.id, t.outcome]));

  const vendorCostByTool: ToolVendorCost[] = featureSlugs.map((featureSlug) => {
    const callsForTool = apiCalls.filter((c) => c.featureSlug === featureSlug);
    const nonRentcast = callsForTool.filter((c) => c.resource !== "rentcast");
    const vendorCostCents = nonRentcast.reduce((sum, c) => sum + (c.costCents ?? 0), 0);

    const toolRentcastCalls = rentcastByFeature.get(featureSlug) ?? 0;
    const rentcastCostCents =
      totalWindowRentcastCalls > 0 ? Math.round((toolRentcastCalls / totalWindowRentcastCalls) * totalPeriodCostCents) : 0;

    const totalCostCents = vendorCostCents + rentcastCostCents;
    const revenueCents = revenueByFeatureSlug.get(featureSlug) ?? 0;

    const failCostCents = callsForTool
      .filter((c) => c.toolUseId && toolUseOutcomeById.get(c.toolUseId) === "fail")
      .reduce((sum, c) => sum + (c.costCents ?? 0), 0);

    return {
      featureSlug,
      vendorCostCents,
      rentcastCostCents,
      totalCostCents,
      revenueCents,
      marginCents: revenueCents - totalCostCents,
      failCostCents,
    };
  });

  // --- Cache effectiveness (Score fresh vs cache) ----------------------------
  const scoreRuns = toolUses.filter((t) => t.featureSlug === "score");
  const scoreRunIds = new Set(scoreRuns.map((r) => r.id));
  const scoreApiCalls = apiCalls.filter((c) => c.toolUseId && scoreRunIds.has(c.toolUseId));

  const costByToolUse = new Map<string, number>();
  for (const c of scoreApiCalls) {
    if (!c.toolUseId) continue;
    costByToolUse.set(c.toolUseId, (costByToolUse.get(c.toolUseId) ?? 0) + (c.costCents ?? 0));
  }

  const freshRuns = scoreRuns.filter((r) => r.compSource === "fresh");
  const cacheRuns = scoreRuns.filter((r) => r.compSource === "cache");
  const sum = (runs: typeof scoreRuns) => runs.reduce((s, r) => s + (costByToolUse.get(r.id) ?? 0), 0);
  const freshCostCents = freshRuns.length > 0 ? sum(freshRuns) / freshRuns.length : 0;
  const cacheCostCents = cacheRuns.length > 0 ? sum(cacheRuns) / cacheRuns.length : 0;

  const cacheEffectiveness: CacheEffectiveness = {
    freshCostCents,
    cacheCostCents,
    gapCents: freshCostCents - cacheCostCents,
    freshCount: freshRuns.length,
    cacheCount: cacheRuns.length,
  };

  // --- Top strip --------------------------------------------------------------
  const totalVendorCostCents = vendorCostByTool.reduce((s, t) => s + t.totalCostCents, 0);
  const totalRevenueCents = vendorCostByTool.reduce((s, t) => s + t.revenueCents, 0);

  return {
    includeAdmin,
    windowDays: WINDOW_DAYS,
    totalRuns: toolUses.length,
    totalVendorCostCents,
    estMarginCents: totalRevenueCents - totalVendorCostCents,
    activeMembers: activeMembersRows.length,
    usage,
    vendorCostByTool,
    rentcast,
    cacheEffectiveness,
  };
}
