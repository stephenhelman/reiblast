// Admin Overview data layer (/admin). Loads the filtered dataset ONCE and
// computes all three lens triads (aggregate hero + per-tool) up front — the
// lens toggle is client-side over this payload, never a refetch. Only Range
// and Source (server-side filters) cause a re-fetch.
//
// AUDIENCE SPLIT (locked, see prisma/schema.prisma ApiCall/LedgerEntry
// comments): this file reads ToolUse + ApiCall (admin-eyes: usage + company
// cost) and Subscription/Tier (revenue estimate). It never reads
// LedgerEntry — that table is client-eyes only (member credits/allowance)
// and carries no company cost; mixing it into these numbers is the one hard
// rule this surface must never violate.

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { RangeKey, SourceFilter, resolveRange, sourceToIsAdminFilter } from "@/lib/adminFilters";
import { brandSlugFor } from "@/lib/brandSlug";
import { getBrandAssets } from "@/lib/brandAssets";

export type Lens = "money" | "users" | "activity";

export type MoneyMetrics = {
  costCents: number | null;
  revenueCents: number | null;
  marginCents: number | null;
  costUnknownCalls: number; // ApiCalls with a null costCents that AREN'T Rentcast (i.e. genuinely unpriced) — flagged, never silently $0
};

export type UsersMetrics = {
  active: number | null;
  unique: number | null;
  churned: number | null;
};

export type ActivityMetrics = {
  ok: number;
  fail: number;
  partial: number;
};

export type ToolCard = {
  slug: string; // catalog Tool slug (score, scrub, ask, acq, dispo, pack) — acq/dispo are separate cards sharing the 'bots' feature
  name: string;
  wordmark: string;
  featureSlug: string;
  live: boolean; // Tool.active OR has real data in range — "soon" tools render dimmed with placeholders
  money: MoneyMetrics;
  users: UsersMetrics;
  activity: ActivityMetrics;
};

export type AdminOverviewData = {
  range: RangeKey;
  source: SourceFilter;
  windowStart: string | null;
  windowEnd: string;
  heroMoney: MoneyMetrics;
  heroUsers: UsersMetrics;
  heroActivity: ActivityMetrics;
  tools: ToolCard[];
};

const RENTCAST_RESOURCE = "rentcast";

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

export async function getAdminOverview(
  range: RangeKey,
  source: SourceFilter,
  db: PrismaClient = defaultPrisma,
  customFrom?: string,
  customTo?: string,
): Promise<AdminOverviewData> {
  const now = new Date();
  const { start: windowStart, end: windowEnd } = resolveRange(range, now, customFrom, customTo);
  const isAdminFilter = sourceToIsAdminFilter(source);

  const toolUseWhere = {
    createdAt: { gte: windowStart ?? undefined, lte: windowEnd },
    ...(isAdminFilter ?? {}),
  };

  const [toolUses, apiCalls, vendorPlan, tools, subs] = await Promise.all([
    db.toolUse.findMany({
      where: toolUseWhere,
      select: { id: true, featureSlug: true, kind: true, outcome: true, createdAt: true, isAdmin: true },
    }),
    db.apiCall.findMany({
      where: { createdAt: { gte: windowStart ?? undefined, lte: windowEnd }, ...(isAdminFilter ?? {}) },
      select: { id: true, toolUseId: true, resource: true, featureSlug: true, costCents: true, createdAt: true },
    }),
    db.vendorPlan.findFirst({ where: { resource: RENTCAST_RESOURCE } }),
    db.tool.findMany({ include: { feature: { include: { tiers: true } } } }),
    // Subscriptions are NOT usage rows — Source (usage-row filter) never
    // applies here. Always excludes the admin user so "an admin isn't a
    // subscriber" never produces a nonsense row in Users/Money-revenue.
    db.subscription.findMany({
      include: { tier: true, feature: true, user: { select: { role: true, status: true } } },
    }),
  ]);

  const realSubs = subs.filter((s) => s.user.role !== "admin");

  // --- Rentcast: period-allocated amortized cost, independent of the Range filter (it's the vendor's own billing period) ---
  const anchorDay = vendorPlan?.periodAnchorDay ?? 1;
  const { periodStart, periodEnd } = currentVendorPeriod(now, anchorDay);
  const periodRentcastCalls = await db.apiCall.count({
    where: { resource: RENTCAST_RESOURCE, createdAt: { gte: periodStart, lt: periodEnd }, ...(isAdminFilter ?? {}) },
  });
  const baseMonthlyCents = vendorPlan?.baseMonthlyCents ?? 0;
  const includedQuota = vendorPlan?.includedQuota ?? 0;
  const overageCentsPerCall = vendorPlan?.overageCentsPerCall ?? 0;
  const overageCalls = Math.max(0, periodRentcastCalls - includedQuota);
  const totalRentcastPeriodCostCents = baseMonthlyCents + overageCalls * overageCentsPerCall;

  // Allocate that period cost across THIS WINDOW's Rentcast calls, proportional to call share.
  const rentcastCallsInWindow = apiCalls.filter((c) => c.resource === RENTCAST_RESOURCE);
  const rentcastByFeature = new Map<string, number>();
  for (const c of rentcastCallsInWindow) {
    const slug = c.featureSlug ?? "unknown";
    rentcastByFeature.set(slug, (rentcastByFeature.get(slug) ?? 0) + 1);
  }
  const totalWindowRentcastCalls = rentcastCallsInWindow.length;
  const rentcastShareFor = (featureSlug: string): number =>
    totalWindowRentcastCalls > 0
      ? Math.round(((rentcastByFeature.get(featureSlug) ?? 0) / totalWindowRentcastCalls) * totalRentcastPeriodCostCents)
      : 0;

  // --- Revenue: Stripe not wired yet -> estimated from active, non-admin Subscription.tier.priceCents ---
  // Source='admin' shows cost w/ zero revenue (admin spend is real, but generates no revenue) — the one
  // spot Source DOES touch a subscription-based number, because it's asking "what did this slice buy us".
  const revenueByFeatureId = new Map<string, number>();
  for (const s of realSubs) {
    if (s.status !== "active") continue;
    revenueByFeatureId.set(s.featureId, (revenueByFeatureId.get(s.featureId) ?? 0) + s.tier.priceCents);
  }
  const revenueApplicable = source !== "admin";

  const subsByFeatureId = new Map<string, typeof realSubs>();
  for (const s of realSubs) {
    const arr = subsByFeatureId.get(s.featureId) ?? [];
    arr.push(s);
    subsByFeatureId.set(s.featureId, arr);
  }

  function usersMetricsFor(featureId: string, hasPaidTier: boolean): UsersMetrics {
    if (!hasPaidTier) return { active: null, unique: null, churned: null };
    const featureSubs = subsByFeatureId.get(featureId) ?? [];
    const active = featureSubs.filter((s) => s.status === "active");
    const unique = new Set(active.map((s) => s.userId)).size;
    const churned = featureSubs.filter((s) => s.status === "canceled" || s.user.status === "inactive").length;
    return { active: active.length, unique, churned };
  }

  function moneyRevenueFor(featureId: string, hasPaidTier: boolean): number | null {
    if (!hasPaidTier) return null;
    if (!revenueApplicable) return 0;
    return revenueByFeatureId.get(featureId) ?? 0;
  }

  // --- Per-run outcome + cost lookups, joined via toolUseId ---
  const toolUseById = new Map(toolUses.map((t) => [t.id, t]));
  const costableApiCalls = apiCalls.filter((c) => c.resource !== RENTCAST_RESOURCE);

  function activityFor(runs: typeof toolUses): ActivityMetrics {
    return {
      ok: runs.filter((r) => r.outcome === "success").length,
      fail: runs.filter((r) => r.outcome === "fail").length,
      partial: runs.filter((r) => r.outcome === "partial").length,
    };
  }

  function moneyCostFor(runIds: Set<string>, featureSlug: string): { costCents: number; unknownCalls: number } {
    const calls = costableApiCalls.filter((c) => c.toolUseId && runIds.has(c.toolUseId));
    let costCents = 0;
    let unknownCalls = 0;
    for (const c of calls) {
      if (c.costCents === null) unknownCalls += 1;
      else costCents += c.costCents;
    }
    return { costCents: costCents + rentcastShareFor(featureSlug), unknownCalls };
  }

  // --- Per-tool cards ---
  const toolCards: ToolCard[] = tools
    .map((t) => {
      const isBotsSplit = t.slug === "acq" || t.slug === "dispo";
      const runs = isBotsSplit
        ? toolUses.filter((r) => r.featureSlug === "bots" && r.kind === t.slug)
        : toolUses.filter((r) => r.featureSlug === t.feature.slug);
      const runIds = new Set(runs.map((r) => r.id));
      const hasPaidTier = t.feature.tiers.some((tier) => tier.priceCents > 0);

      const { costCents, unknownCalls } = moneyCostFor(runIds, t.feature.slug);
      const revenueCents = moneyRevenueFor(t.featureId, hasPaidTier);
      const marginCents = revenueCents === null ? null : revenueCents - costCents;

      const live = t.active || runs.length > 0;

      return {
        slug: t.slug,
        name: t.name,
        wordmark: getBrandAssets(brandSlugFor(t.slug)).wordmark,
        featureSlug: t.feature.slug,
        live,
        money: { costCents: live ? costCents : null, revenueCents: live ? revenueCents : null, marginCents: live ? marginCents : null, costUnknownCalls: unknownCalls },
        users: live ? usersMetricsFor(t.featureId, hasPaidTier) : { active: null, unique: null, churned: null },
        activity: live ? activityFor(runs) : { ok: 0, fail: 0, partial: 0 },
      };
    })
    // score, scrub, ask, acq, dispo, pack — stable, matches the approved mockup ordering
    .sort((a, b) => {
      const order = ["score", "scrub", "ask", "acq", "dispo", "pack"];
      return order.indexOf(a.slug) - order.indexOf(b.slug);
    });

  // --- Hero (aggregate) ---
  const heroCostCents = costableApiCalls.reduce((s, c) => s + (c.costCents ?? 0), 0) + totalRentcastPeriodCostCents * (totalWindowRentcastCalls > 0 ? 1 : 0);
  const heroUnknownCalls = costableApiCalls.filter((c) => c.costCents === null).length;
  const heroRevenueCents = revenueApplicable ? Array.from(revenueByFeatureId.values()).reduce((s, v) => s + v, 0) : 0;

  const heroMoney: MoneyMetrics = {
    costCents: heroCostCents,
    revenueCents: heroRevenueCents,
    marginCents: heroRevenueCents - heroCostCents,
    costUnknownCalls: heroUnknownCalls,
  };

  const activeSubs = realSubs.filter((s) => s.status === "active");
  const heroUsers: UsersMetrics = {
    active: activeSubs.length,
    unique: new Set(activeSubs.map((s) => s.userId)).size,
    churned: realSubs.filter((s) => s.status === "canceled" || s.user.status === "inactive").length,
  };

  const heroActivity = activityFor(toolUses);

  return {
    range,
    source,
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd.toISOString(),
    heroMoney,
    heroUsers,
    heroActivity,
    tools: toolCards,
  };
}
