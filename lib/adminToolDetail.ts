// Admin Tool deep page (/admin/tools/[slug]) data layer. Same load-once,
// compute-all-lenses shape as lib/adminDashboard.ts / lib/adminTools.ts: the
// filtered dataset for {slug} x Range x Source x member is loaded ONCE, all
// three lenses computed up front — the lens toggle + in-chart legend toggles
// are client-side over this payload. Range/Source/member changes refetch.
//
// AUDIENCE SPLIT (locked — see prisma/schema.prisma ApiCall/LedgerEntry
// comments): cost/usage come from ApiCall/ToolUse (admin-eyes). The ONE
// exception, called out explicitly in the deep-page spec, is the
// allowance-vs-credit chart: it aggregates LedgerEntry.allowanceCovered for
// THIS tool — a business plan-fit signal, not a per-member money read. It
// carries no company cost and is never broken out by anything but
// allowance-vs-credit, so it doesn't violate the "LedgerEntry is client-eyes"
// rule the rest of these accessors hold to.
//
// VENDOR BREAKDOWN is PURE ApiCall — never derived from ToolUse/run counts,
// since caching means calls != uses. Rentcast cost uses the corrected
// read-side amortization from lib/adminDashboard.ts's getRentcastEconomics:
// period_spend = base + max(0, period_calls - quota) x overage;
// per_call_cost = period_spend / TOTAL PERIOD calls; scope_cost = scope's
// own call count x per_call_cost.

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { RangeKey, SourceFilter, resolveRange, sourceToIsAdminFilter } from "@/lib/adminFilters";
import { brandSlugFor } from "@/lib/brandSlug";
import { getBrandAssets } from "@/lib/brandAssets";
import { getRentcastEconomics, usageRecognizedRevenueCents, CREDIT_DOLLARS_PER_CREDIT_CENTS, RENTCAST_RESOURCE, type Lens } from "@/lib/adminDashboard";
import { deriveTierName } from "@/lib/catalogDerive";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BUCKETS = 60;

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

export type ToolTrendPoint = {
  date: string;
  moneyClient: { cost: number; rev: number; margin: number };
  moneyAdmin: { cost: number; rev: number; margin: number };
  // Subscriptions carry no admin/client dimension (an admin isn't a subscriber) — one line, not split.
  users: { active: number; unique: number; churned: number };
  activityClient: { ok: number; fail: number; partial: number };
  activityAdmin: { ok: number; fail: number; partial: number };
};

export type MoneyHero = {
  subRevenueCents: number;
  subRevenueEstimated: boolean; // true until Stripe is wired
  creditRevenueCents: number;
  creditsPerUse: number; // Feature.creditCost — the multiplier in creditUses x creditsPerUse x $0.25
  vendorCostCents: number;
  marginCents: number;
  costUnknownCalls: number;
};

export type UsersHero = { active: number; unique: number; churned: number };
export type ActivityHero = { ok: number; fail: number; partial: number };

export type VendorCard = {
  resource: string;
  calls: number;
  costCents: number;
  thirdStat: { label: string; value: string };
  rentcastMath: {
    periodSpendCents: number;
    periodCalls: number;
    perCallCostCents: number;
    scopeCalls: number;
    scopeCostCents: number;
  } | null;
};

export type AllowanceFitPoint = { date: string; allowance: number; credit: number };

export type AllowanceFit = {
  allowanceCovered: number;
  creditCovered: number;
  series: AllowanceFitPoint[];
};

export type ToolLeaderboardRow = { userId: string; name: string; locationId: string; value: number; displayValue: string };

export type MemberOption = { id: string; name: string; locationId: string };

export type ToolDetailData = {
  slug: string;
  name: string;
  wordmark: string;
  featureSlug: string;
  live: boolean;
  range: RangeKey;
  source: SourceFilter;
  windowStart: string | null;
  windowEnd: string;
  member: MemberOption | null;
  members: MemberOption[]; // candidates for the search box — everyone who has touched this tool
  glance: { totalRuns: number; allowanceCoveredRuns: number; creditRuns: number };
  hero: { money: MoneyHero; users: UsersHero; activity: ActivityHero };
  series: ToolTrendPoint[];
  vendorCards: VendorCard[];
  allowanceFit: AllowanceFit;
  leaderboards: Record<Lens, ToolLeaderboardRow[]>;
};

export async function getAdminToolDetail(
  slug: string,
  range: RangeKey,
  source: SourceFilter,
  memberUserId: string | null,
  db: PrismaClient = defaultPrisma,
  customFrom?: string,
  customTo?: string,
): Promise<ToolDetailData | null> {
  const tool = await db.tool.findUnique({ where: { slug }, include: { feature: { include: { tiers: true } } } });
  if (!tool) return null;

  const now = new Date();
  const { start: rawStart, end: windowEnd } = resolveRange(range, now, customFrom, customTo);
  const windowStart = rawStart ?? new Date(windowEnd.getTime() - 30 * DAY_MS);
  const isAdminFilter = sourceToIsAdminFilter(source);
  // A selected member has no admin/client dimension of their own — Source resets to "both" server-side too.
  const effectiveIsAdminFilter = memberUserId ? undefined : isAdminFilter;

  const isBotsSplit = tool.slug === "acq" || tool.slug === "dispo";
  const runWhere = isBotsSplit ? { featureSlug: "bots", kind: tool.slug } : { featureSlug: tool.feature.slug };

  const [toolUses, apiCallsAll, rentcastEcon, subs, ledgerAll] = await Promise.all([
    db.toolUse.findMany({
      where: {
        ...runWhere,
        createdAt: { gte: windowStart, lte: windowEnd },
        ...(effectiveIsAdminFilter ?? {}),
        ...(memberUserId ? { userId: memberUserId } : {}),
      },
      select: { id: true, userId: true, locationId: true, outcome: true, createdAt: true, isAdmin: true },
    }),
    db.apiCall.findMany({
      where: { createdAt: { gte: windowStart, lte: windowEnd }, ...(effectiveIsAdminFilter ?? {}) },
      select: {
        id: true,
        toolUseId: true,
        locationId: true,
        resource: true,
        costCents: true,
        createdAt: true,
        isAdmin: true,
        durationMs: true,
        inputTokens: true,
        outputTokens: true,
        model: true,
      },
    }),
    getRentcastEconomics(db, now),
    db.subscription.findMany({
      where: { featureId: tool.featureId },
      include: { tier: true, user: { select: { id: true, name: true, role: true, status: true, ghlLocationId: true } } },
    }),
    db.ledgerEntry.findMany({
      where: {
        toolId: tool.id,
        kind: "consumption",
        createdAt: { gte: windowStart, lte: windowEnd },
        ...(memberUserId ? { userId: memberUserId } : {}),
      },
      select: { id: true, userId: true, allowanceCovered: true, createdAt: true },
    }),
  ]);

  const realSubs = subs.filter((s) => s.user.role !== "admin");
  const revenueApplicable = source !== "admin" || !!memberUserId;
  const hasPaidTier = tool.feature.tiers.some((t) => t.priceCents > 0);

  // --- scope runs (this tool, this window, this source/member) — apiCalls joined via toolUseId ---
  const runIds = new Set(toolUses.map((r) => r.id));
  const scopedApiCalls = apiCallsAll.filter((c) => c.toolUseId && runIds.has(c.toolUseId));
  const costableCalls = scopedApiCalls.filter((c) => c.resource !== RENTCAST_RESOURCE);
  const rentcastCalls = scopedApiCalls.filter((c) => c.resource === RENTCAST_RESOURCE);

  const rentcastPerCallCostCents = rentcastEcon.perCallCostCents;
  const rentcastScopeCostCents = Math.round(rentcastCalls.length * rentcastPerCallCostCents);

  const vendorCostCents = costableCalls.reduce((s, c) => s + (c.costCents ?? 0), 0) + rentcastScopeCostCents;
  const costUnknownCalls = costableCalls.filter((c) => c.costCents === null).length;

  // --- subscription revenue: Stripe not wired -> estimated (list) from Tier.priceCents ---
  const scopedSubs = memberUserId ? realSubs.filter((s) => s.userId === memberUserId) : realSubs;
  const activeSubs = scopedSubs.filter((s) => s.status === "active");
  const subRevenueCents = hasPaidTier && revenueApplicable ? activeSubs.reduce((s, sub) => s + sub.tier.priceCents, 0) : 0;

  // --- credit revenue: credit-attributed uses x credits-per-use x $0.25 ---
  const creditUses = ledgerAll.filter((l) => l.allowanceCovered === false);
  const allowanceUses = ledgerAll.filter((l) => l.allowanceCovered === true);
  const creditRevenueCents = creditUses.length * tool.feature.creditCost * CREDIT_DOLLARS_PER_CREDIT_CENTS;

  const marginCents = subRevenueCents + creditRevenueCents - vendorCostCents;

  const activityFor = (runs: typeof toolUses) => ({
    ok: runs.filter((r) => r.outcome === "success").length,
    fail: runs.filter((r) => r.outcome === "fail").length,
    partial: runs.filter((r) => r.outcome === "partial").length,
  });

  const usersHero: UsersHero = {
    active: activeSubs.length,
    unique: new Set(activeSubs.map((s) => s.userId)).size,
    churned: scopedSubs.filter((s) => s.status === "canceled" || s.user.status === "inactive").length,
  };

  const hero = {
    money: {
      subRevenueCents,
      subRevenueEstimated: true,
      creditRevenueCents,
      creditsPerUse: tool.feature.creditCost,
      vendorCostCents,
      marginCents,
      costUnknownCalls,
    },
    users: usersHero,
    activity: activityFor(toolUses),
  };

  const glance = {
    totalRuns: toolUses.length,
    allowanceCoveredRuns: allowanceUses.length,
    creditRuns: creditUses.length,
  };

  // --- main chart: per-day buckets, client/admin split for money + activity ---
  const days = bucketDays(windowStart, windowEnd);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  function bucketOf(date: Date): number | null {
    if (date.getTime() < windowStart.getTime() || date.getTime() > windowEnd.getTime()) return null;
    return dayIndex.get(dayKey(date)) ?? 0;
  }

  const series: ToolTrendPoint[] = days.map((date) => ({
    date,
    moneyClient: { cost: 0, rev: 0, margin: 0 },
    moneyAdmin: { cost: 0, rev: 0, margin: 0 },
    users: { active: usersHero.active, unique: usersHero.unique, churned: 0 },
    activityClient: { ok: 0, fail: 0, partial: 0 },
    activityAdmin: { ok: 0, fail: 0, partial: 0 },
  }));

  for (const c of costableCalls) {
    const idx = bucketOf(c.createdAt);
    if (idx === null || c.costCents === null) continue;
    (c.isAdmin ? series[idx].moneyAdmin : series[idx].moneyClient).cost += c.costCents;
  }
  if (rentcastCalls.length > 0) {
    for (const c of rentcastCalls) {
      const idx = bucketOf(c.createdAt);
      if (idx === null) continue;
      (c.isAdmin ? series[idx].moneyAdmin : series[idx].moneyClient).cost += Math.round(rentcastPerCallCostCents);
    }
  }

  // --- chart revenue: usage-RECOGNIZED, not the flat Stripe total shown on the hero card.
  // The hero "Subscription revenue" card is billed money (what Stripe actually charged this
  // period) — a flat fact, correctly flat. The chart instead answers "how much value did usage
  // recognize over time", so it has real shape: an allowance-covered run recognizes
  // (that member's sub price / their tier's allowance) of the flat fee they already paid; a
  // credit-covered run recognizes creditsPerUse x $0.25, same as the credit-revenue hero card.
  // LedgerEntry rows are inherently client-only (admin runs never write one — see schema
  // comment), so this only ever fills moneyClient.rev; moneyAdmin.rev stays 0.
  const tierByUserId = new Map<string, { priceCents: number; allowance: number | null }>();
  for (const s of activeSubs) {
    tierByUserId.set(s.userId, { priceCents: s.tier.priceCents, allowance: s.tier.allowance });
  }
  const creditRevPerUseCents = tool.feature.creditCost * CREDIT_DOLLARS_PER_CREDIT_CENTS;
  if (revenueApplicable) {
    for (const l of ledgerAll) {
      const idx = bucketOf(l.createdAt);
      if (idx === null) continue;
      series[idx].moneyClient.rev += usageRecognizedRevenueCents(l, tierByUserId, creditRevPerUseCents);
    }
  }
  for (const p of series) {
    p.moneyClient.rev = Math.round(p.moneyClient.rev);
    p.moneyClient.margin = p.moneyClient.rev - p.moneyClient.cost;
    p.moneyAdmin.margin = p.moneyAdmin.rev - p.moneyAdmin.cost;
  }
  for (const r of toolUses) {
    const idx = bucketOf(r.createdAt);
    if (idx === null) continue;
    const bucket = r.isAdmin ? series[idx].activityAdmin : series[idx].activityClient;
    if (r.outcome === "success") bucket.ok += 1;
    else if (r.outcome === "fail") bucket.fail += 1;
    else if (r.outcome === "partial") bucket.partial += 1;
  }
  for (const s of scopedSubs) {
    if (s.status !== "canceled" && s.user.status !== "inactive") continue;
    const idx = bucketOf(s.periodEnd);
    if (idx === null) continue;
    series[idx].users.churned += 1;
  }

  // --- vendor breakdown: PURE ApiCall, distinct resource values on this tool's calls ---
  const resources = Array.from(new Set(scopedApiCalls.map((c) => c.resource)));
  const vendorCards: VendorCard[] = resources.map((resource) => {
    const calls = scopedApiCalls.filter((c) => c.resource === resource);
    if (resource === RENTCAST_RESOURCE) {
      return {
        resource,
        calls: calls.length,
        costCents: rentcastScopeCostCents,
        thirdStat: {
          label: "avg latency",
          value: calls.length ? `${Math.round(calls.reduce((s, c) => s + (c.durationMs ?? 0), 0) / calls.length)}ms` : "—",
        },
        rentcastMath: {
          periodSpendCents: rentcastEcon.periodSpendCents,
          periodCalls: rentcastEcon.periodRentcastCalls,
          perCallCostCents: rentcastEcon.perCallCostCents,
          scopeCalls: calls.length,
          scopeCostCents: rentcastScopeCostCents,
        },
      };
    }
    const costCents = calls.reduce((s, c) => s + (c.costCents ?? 0), 0);
    const isAnthropic = resource === "anthropic";
    const thirdStat = isAnthropic
      ? { label: "tokens", value: formatTokenCount(calls.reduce((s, c) => s + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0)) }
      : { label: "avg latency", value: calls.length ? `${Math.round(calls.reduce((s, c) => s + (c.durationMs ?? 0), 0) / calls.length)}ms` : "—" };
    return { resource, calls: calls.length, costCents, thirdStat, rentcastMath: null };
  });

  // --- allowance vs credit fit (the one admin-eyes ledger aggregate; not revenue) ---
  const allowanceSeries: AllowanceFitPoint[] = days.map((date) => ({ date, allowance: 0, credit: 0 }));
  for (const l of ledgerAll) {
    const idx = bucketOf(l.createdAt);
    if (idx === null) continue;
    if (l.allowanceCovered === true) allowanceSeries[idx].allowance += 1;
    else if (l.allowanceCovered === false) allowanceSeries[idx].credit += 1;
  }
  const allowanceFit: AllowanceFit = {
    allowanceCovered: allowanceUses.length,
    creditCovered: creditUses.length,
    series: allowanceSeries,
  };

  // --- leaderboard: rank members on THIS tool, follows the lens ---
  const costByLocation = new Map<string, number>();
  for (const c of costableCalls) {
    if (c.costCents === null) continue;
    costByLocation.set(c.locationId, (costByLocation.get(c.locationId) ?? 0) + c.costCents);
  }
  for (const c of rentcastCalls) {
    costByLocation.set(c.locationId, (costByLocation.get(c.locationId) ?? 0) + Math.round(rentcastPerCallCostCents));
  }
  const activityByUser = new Map<string, number>();
  for (const r of toolUses) {
    activityByUser.set(r.userId, (activityByUser.get(r.userId) ?? 0) + 1);
  }

  const locationIds = Array.from(new Set(toolUses.map((r) => r.locationId)));
  const locationUsers = locationIds.length
    ? await db.user.findMany({ where: { ghlLocationId: { in: locationIds } }, select: { id: true, name: true, ghlLocationId: true } })
    : [];
  const userByLocation = new Map(locationUsers.filter((u) => u.ghlLocationId).map((u) => [u.ghlLocationId as string, u]));

  function topN(map: Map<string, number>, byLocation: boolean, format: (v: number) => string): ToolLeaderboardRow[] {
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, value]) => {
        const u = byLocation ? userByLocation.get(key) : locationUsers.find((x) => x.id === key);
        return { userId: u?.id ?? key, name: u?.name ?? key, locationId: byLocation ? key : u?.ghlLocationId ?? "—", value, displayValue: format(value) };
      });
  }

  const activeByUser = new Map<string, string>();
  for (const s of activeSubs) {
    activeByUser.set(s.userId, deriveTierName(tool.feature.unifiedName ?? tool.feature.slug, s.tier));
  }
  const usersLeaderboard: ToolLeaderboardRow[] = activeSubs.map((s) => {
    const u = s.user;
    return {
      userId: u.id,
      name: u.name ?? u.id,
      locationId: u.ghlLocationId ?? "—",
      value: 1,
      displayValue: activeByUser.get(u.id) ?? "—",
    };
  });

  const leaderboards: Record<Lens, ToolLeaderboardRow[]> = {
    money: topN(costByLocation, true, (v) => formatCentsShort(v)),
    users: usersLeaderboard.slice(0, 5),
    activity: topN(activityByUser, false, (v) => v.toLocaleString()),
  };

  // --- member search candidates: everyone with a run on this tool in the window ---
  const memberOptionsById = new Map<string, MemberOption>();
  for (const r of toolUses) {
    const u = locationUsers.find((x) => x.id === r.userId);
    if (u) memberOptionsById.set(u.id, { id: u.id, name: u.name ?? u.id, locationId: u.ghlLocationId ?? "—" });
  }
  const userIdsNeeded = Array.from(new Set(toolUses.map((r) => r.userId))).filter((id) => !memberOptionsById.has(id));
  if (userIdsNeeded.length) {
    const extra = await db.user.findMany({ where: { id: { in: userIdsNeeded } }, select: { id: true, name: true, ghlLocationId: true } });
    for (const u of extra) memberOptionsById.set(u.id, { id: u.id, name: u.name ?? u.id, locationId: u.ghlLocationId ?? "—" });
  }

  let member: MemberOption | null = null;
  if (memberUserId) {
    member = memberOptionsById.get(memberUserId) ?? null;
    if (!member) {
      const u = await db.user.findUnique({ where: { id: memberUserId }, select: { id: true, name: true, ghlLocationId: true } });
      member = u ? { id: u.id, name: u.name ?? u.id, locationId: u.ghlLocationId ?? "—" } : null;
    }
  }

  return {
    slug: tool.slug,
    name: tool.name,
    wordmark: getBrandAssets(brandSlugFor(tool.slug)).wordmark,
    featureSlug: tool.feature.slug,
    live: tool.active || toolUses.length > 0,
    range,
    source,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    member,
    members: Array.from(memberOptionsById.values()).sort((a, b) => a.name.localeCompare(b.name)),
    glance,
    hero,
    series,
    vendorCards,
    allowanceFit,
    leaderboards,
  };
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCentsShort(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
