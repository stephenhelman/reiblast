// Admin Tools data layer (/admin/tools). Same load-once-compute-all-lenses
// shape as lib/adminDashboard.ts: filtered dataset loaded ONCE per Range x
// Source, all three lenses' per-tool day series + totals + leaderboards
// computed up front. The lens toggle is client-side over this payload.
//
// AUDIENCE SPLIT (locked — see prisma/schema.prisma ApiCall/LedgerEntry
// comments): reads ToolUse + ApiCall (admin-eyes: usage + company cost) and
// Subscription/Tier (revenue estimate). The one exception — same as the
// deep page's — is a LedgerEntry.allowanceCovered read, needed ONLY to give
// each tool's chart REVENUE LINE real per-day shape (see
// usageRecognizedRevenueCents below); it's a business plan-fit aggregate,
// never broken out per-member here, so it doesn't violate the client-eyes
// rule the rest of this file holds to.
//
// This page renders CLIENT-ONLY series regardless of Source — Source still
// filters which usage rows are in scope (via isAdmin), it just doesn't split
// the rendered lines here. The admin/client split is deferred to /[slug].

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { RangeKey, SourceFilter, resolveRange, sourceToIsAdminFilter } from "@/lib/adminFilters";
import { brandSlugFor } from "@/lib/brandSlug";
import { getBrandAssets } from "@/lib/brandAssets";
import { getRentcastEconomics, usageRecognizedRevenueCents, CREDIT_DOLLARS_PER_CREDIT_CENTS, type Lens } from "@/lib/adminDashboard";

const RENTCAST_RESOURCE = "rentcast";
const TOOL_ORDER = ["score", "scrub", "ask", "acq", "dispo", "pack"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BUCKETS = 60; // wide windows (e.g. "all time") downsample to the trailing N days so the chart stays legible

export type ToolTrendPoint = {
  date: string; // yyyy-mm-dd bucket (UTC)
  money: { cost: number; rev: number; margin: number };
  users: { active: number; unique: number; churned: number };
  activity: { ok: number; fail: number; partial: number };
};

export type ToolTotals = {
  money: { cost: number; rev: number; margin: number; costUnknownCalls: number };
  users: { active: number; unique: number; churned: number };
  activity: { ok: number; fail: number; partial: number };
};

export type ToolRow = {
  slug: string;
  name: string;
  wordmark: string;
  featureSlug: string;
  live: boolean; // false = "Soon" / not launched — non-expandable
  hasPaidTier: boolean;
  series: ToolTrendPoint[];
  totals: ToolTotals;
};

export type LeaderboardRow = { key: string; name: string; locationId: string; value: number };

export type AdminToolsData = {
  range: RangeKey;
  source: SourceFilter;
  windowStart: string;
  windowEnd: string;
  tools: ToolRow[];
  leaderboards: Record<Lens, LeaderboardRow[]>;
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bucketDays(start: Date, end: Date): string[] {
  const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const days: string[] = [];
  for (let t = startDay.getTime(), guard = 0; t <= endDay.getTime() && guard < 2000; t += DAY_MS, guard++) {
    days.push(dayKey(new Date(t)));
  }
  return days.length > MAX_BUCKETS ? days.slice(days.length - MAX_BUCKETS) : days;
}

export async function getAdminTools(
  range: RangeKey,
  source: SourceFilter,
  db: PrismaClient = defaultPrisma,
  customFrom?: string,
  customTo?: string,
): Promise<AdminToolsData> {
  const now = new Date();
  const { start: rawStart, end: windowEnd } = resolveRange(range, now, customFrom, customTo);
  const windowStart = rawStart ?? new Date(windowEnd.getTime() - 30 * DAY_MS);
  const isAdminFilter = sourceToIsAdminFilter(source);

  const [toolUses, apiCalls, rentcastEcon, tools, subs, ledgerAll] = await Promise.all([
    db.toolUse.findMany({
      where: { createdAt: { gte: windowStart, lte: windowEnd }, ...(isAdminFilter ?? {}) },
      select: { id: true, locationId: true, userId: true, featureSlug: true, kind: true, outcome: true, createdAt: true },
    }),
    db.apiCall.findMany({
      where: { createdAt: { gte: windowStart, lte: windowEnd }, ...(isAdminFilter ?? {}) },
      select: { id: true, toolUseId: true, locationId: true, resource: true, costCents: true, createdAt: true },
    }),
    // Same corrected formula as Overview — independent of Range, it's the vendor's own billing period.
    getRentcastEconomics(db, now),
    db.tool.findMany({ include: { feature: { include: { tiers: true } } } }),
    db.subscription.findMany({
      include: { tier: true, user: { select: { id: true, name: true, role: true, status: true, ghlLocationId: true } } },
    }),
    // Chart-line revenue only (see usageRecognizedRevenueCents) — never used for the flat totals below.
    db.ledgerEntry.findMany({
      where: { kind: "consumption", createdAt: { gte: windowStart, lte: windowEnd } },
      select: { userId: true, toolId: true, allowanceCovered: true, createdAt: true },
    }),
  ]);

  const realSubs = subs.filter((s) => s.user.role !== "admin");
  const revenueApplicable = source !== "admin";

  // per_call_cost = period_spend / total PERIOD calls (never this window's own call
  // count — that misallocates whenever Range != the vendor's billing period).
  const rentcastPerCallCostCents = rentcastEcon.perCallCostCents;
  function rentcastShareOf(windowCallCount: number): number {
    return Math.round(windowCallCount * rentcastPerCallCostCents);
  }

  const revenueByFeatureId = new Map<string, number>();
  for (const s of realSubs) {
    if (s.status !== "active") continue;
    revenueByFeatureId.set(s.tier.featureId, (revenueByFeatureId.get(s.tier.featureId) ?? 0) + s.tier.priceCents);
  }

  const days = bucketDays(windowStart, windowEnd);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  function bucketOf(date: Date): number | null {
    if (date.getTime() < windowStart.getTime() || date.getTime() > windowEnd.getTime()) return null;
    const idx = dayIndex.get(dayKey(date));
    // downsampled windows drop early buckets — fold anything before the first kept bucket into it
    return idx ?? 0;
  }

  const toolRows: ToolRow[] = tools
    .map((t) => {
      const isBotsSplit = t.slug === "acq" || t.slug === "dispo";
      const runs = isBotsSplit
        ? toolUses.filter((r) => r.featureSlug === "bots" && r.kind === t.slug)
        : toolUses.filter((r) => r.featureSlug === t.feature.slug);
      const runIds = new Set(runs.map((r) => r.id));
      const hasPaidTier = t.feature.tiers.some((tier) => tier.priceCents > 0);
      const live = t.active || runs.length > 0;

      const calls = apiCalls.filter((c) => c.toolUseId && runIds.has(c.toolUseId));
      const costableCalls = calls.filter((c) => c.resource !== RENTCAST_RESOURCE);
      const rentcastCalls = calls.filter((c) => c.resource === RENTCAST_RESOURCE);
      const toolRentcastShare = rentcastShareOf(rentcastCalls.length);

      const featureSubs = realSubs.filter((s) => s.tier.featureId === t.featureId);
      const activeFeatureSubs = featureSubs.filter((s) => s.status === "active");
      const uniqueActive = new Set(activeFeatureSubs.map((s) => s.userId)).size;
      const churnedSubs = featureSubs.filter((s) => s.status === "canceled" || s.user.status === "inactive");

      const revenueTotal = hasPaidTier && revenueApplicable ? revenueByFeatureId.get(t.featureId) ?? 0 : 0;

      const series: ToolTrendPoint[] = days.map((date) => ({
        date,
        money: { cost: 0, rev: 0, margin: 0 },
        users: { active: activeFeatureSubs.length, unique: uniqueActive, churned: 0 },
        activity: { ok: 0, fail: 0, partial: 0 },
      }));

      // Chart revenue line: usage-RECOGNIZED per day (see usageRecognizedRevenueCents) — NOT
      // revenueTotal (the flat Stripe total) spread evenly, which draws a flat line and hides
      // exactly the usage swings the chart exists to show. revenueTotal itself is untouched and
      // still what totals.money.rev reports below.
      if (hasPaidTier && revenueApplicable) {
        const tierByUserId = new Map<string, { priceCents: number; allowance: number | null }>();
        for (const s of activeFeatureSubs) tierByUserId.set(s.userId, { priceCents: s.tier.priceCents, allowance: s.tier.allowance });
        const creditRevPerUseCents = t.feature.creditCost * CREDIT_DOLLARS_PER_CREDIT_CENTS;
        const toolLedger = ledgerAll.filter((l) => l.toolId === t.id);
        for (const l of toolLedger) {
          const idx = bucketOf(l.createdAt);
          if (idx === null) continue;
          series[idx].money.rev += usageRecognizedRevenueCents(l, tierByUserId, creditRevPerUseCents);
        }
        for (const p of series) p.money.rev = Math.round(p.money.rev);
      }

      let unknownCalls = 0;
      for (const c of costableCalls) {
        const idx = bucketOf(c.createdAt);
        if (idx === null) continue;
        if (c.costCents === null) unknownCalls += 1;
        else series[idx].money.cost += c.costCents;
      }
      const totalToolRentcastCalls = rentcastCalls.length;
      if (totalToolRentcastCalls > 0) {
        for (const c of rentcastCalls) {
          const idx = bucketOf(c.createdAt);
          if (idx === null) continue;
          series[idx].money.cost += Math.round(toolRentcastShare / totalToolRentcastCalls);
        }
      }
      for (const p of series) p.money.margin = p.money.rev - p.money.cost;

      for (const r of runs) {
        const idx = bucketOf(r.createdAt);
        if (idx === null) continue;
        if (r.outcome === "success") series[idx].activity.ok += 1;
        else if (r.outcome === "fail") series[idx].activity.fail += 1;
        else if (r.outcome === "partial") series[idx].activity.partial += 1;
      }
      // Churn events bucketed by the subscription's periodEnd (closest thing to a churn date we persist).
      for (const s of churnedSubs) {
        const idx = bucketOf(s.periodEnd);
        if (idx === null) continue;
        series[idx].users.churned += 1;
      }

      const costTotal = costableCalls.reduce((sum, c) => sum + (c.costCents ?? 0), 0) + toolRentcastShare;
      const okTotal = runs.filter((r) => r.outcome === "success").length;
      const failTotal = runs.filter((r) => r.outcome === "fail").length;
      const partialTotal = runs.filter((r) => r.outcome === "partial").length;

      return {
        slug: t.slug,
        name: t.name,
        wordmark: getBrandAssets(brandSlugFor(t.slug)).wordmark,
        featureSlug: t.feature.slug,
        live,
        hasPaidTier,
        series,
        totals: {
          money: { cost: costTotal, rev: revenueTotal, margin: revenueTotal - costTotal, costUnknownCalls: unknownCalls },
          users: { active: activeFeatureSubs.length, unique: uniqueActive, churned: churnedSubs.length },
          activity: { ok: okTotal, fail: failTotal, partial: partialTotal },
        },
      };
    })
    .sort((a, b) => TOOL_ORDER.indexOf(a.slug) - TOOL_ORDER.indexOf(b.slug));

  // --- Leaderboards: one ranked member list per lens ---
  const moneyByLocation = new Map<string, number>();
  for (const c of apiCalls) {
    if (c.resource === RENTCAST_RESOURCE || c.costCents === null) continue;
    moneyByLocation.set(c.locationId, (moneyByLocation.get(c.locationId) ?? 0) + c.costCents);
  }
  const activityByLocation = new Map<string, number>();
  for (const r of toolUses) {
    activityByLocation.set(r.locationId, (activityByLocation.get(r.locationId) ?? 0) + 1);
  }
  const activeSubsAll = realSubs.filter((s) => s.status === "active");
  const subCountByUserId = new Map<string, number>();
  for (const s of activeSubsAll) {
    subCountByUserId.set(s.userId, (subCountByUserId.get(s.userId) ?? 0) + 1);
  }

  const relevantLocationIds = Array.from(new Set([...moneyByLocation.keys(), ...activityByLocation.keys()]));
  const locationUsers = relevantLocationIds.length
    ? await db.user.findMany({ where: { ghlLocationId: { in: relevantLocationIds } }, select: { name: true, ghlLocationId: true } })
    : [];
  const nameByLocation = new Map(locationUsers.filter((u) => u.ghlLocationId).map((u) => [u.ghlLocationId as string, u.name]));

  function topByLocation(map: Map<string, number>): LeaderboardRow[] {
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([locationId, value]) => ({ key: locationId, name: nameByLocation.get(locationId) ?? locationId, locationId, value }));
  }

  const subUserIds = Array.from(subCountByUserId.keys());
  const subUsers = subUserIds.length
    ? await db.user.findMany({ where: { id: { in: subUserIds } }, select: { id: true, name: true, ghlLocationId: true } })
    : [];
  const subUserById = new Map(subUsers.map((u) => [u.id, u]));
  const usersLeaderboard: LeaderboardRow[] = Array.from(subCountByUserId.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, value]) => {
      const u = subUserById.get(userId);
      return { key: userId, name: u?.name ?? userId, locationId: u?.ghlLocationId ?? "—", value };
    });

  return {
    range,
    source,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    tools: toolRows,
    leaderboards: {
      money: topByLocation(moneyByLocation),
      users: usersLeaderboard,
      activity: topByLocation(activityByLocation),
    },
  };
}
