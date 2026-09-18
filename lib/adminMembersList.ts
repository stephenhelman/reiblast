// Admin Members list (/admin/members) data layer — READ-ONLY roster + attention
// queue. Admin-eyes: unlike the old client-eyes member lookup, this surface is
// allowed to show vendor cost/margin and read LedgerEntry.allowanceCovered as
// a business signal (the sanctioned admin-eyes ledger read — see
// lib/adminToolDetail.ts's AUDIENCE SPLIT note). Bundle status is always
// derived via lib/bundleQualify.ts, never re-derived here.
//
// MONEY: revenue/cost/margin route through lib/adminMoney.ts — the SAME
// functions Overview (lib/adminDashboard.ts) and Tools (lib/adminTools.ts)
// use, so sum(per-member revenue/margin) reconciles to Overview's totals (at
// Source=Client, since Members has no admin/client toggle — the admin user
// is never a member). Members has no Range selector, so it always reads
// ALL TIME (window start = null) — the same convention as Overview's "All
// time" — and reconciles against THAT view specifically.
// Cost is attributed by ApiCall.locationId here (member-shaped scope) rather
// than the toolUseId join Overview/Tools use (tool-shaped scope) — the two
// joins land on the same set of non-admin ApiCall rows in total, just sliced
// a different way, so the totals still reconcile.

import { PrismaClient, TierLevel } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { qualifyBundle, type QualifyingTiers } from "@/lib/bundleQualify";
import { deriveTierName } from "@/lib/catalogDerive";
import { getRentcastEconomics, RENTCAST_RESOURCE } from "@/lib/adminDashboard";
import { creditRevenueCents, splitIntegerProportional } from "@/lib/adminMoney";

// Tools with a plan/bundle upgrade path — only usage on these features can
// ever make someone a real upsell prospect (a pack-only user on a feature
// with no plan alternative is not a false-positive upsell — there's no tier
// ladder to check them against at all).
const UPGRADEABLE_FEATURE_SLUGS = new Set(["score", "ask"]);

// base -> plus -> pro, same ladder lib/engine/resolver.ts and
// lib/bundleQualify.ts use — never re-derive tier ordering elsewhere.
const LEVEL_RANK: Record<TierLevel, number> = { base: 0, plus: 1, pro: 2 };

const DOWNSELL_ALLOWANCE_USE_THRESHOLD = 0.25;
const DOWNSELL_NEAR_ZERO_CREDITS = 5; // wallet balance at/below this counts as "near-zero credits"

function calendarMonthWindow(now: Date): { periodStart: Date; periodEnd: Date } {
  // Same convention as lib/engine/resolver.ts's implicit-base-tier window —
  // a member with no active Subscription on a feature still gets that
  // feature's free 'base' tier, resolved against a calendar month (no
  // persisted Subscription row to read a real period off of).
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

export type MemberFlag = "past_due" | "neg_bal" | "upsell" | "downsell";
export type PlanFit = "upsell" | "downsell" | "healthy";
export type MemberStatus = "active" | "past_due" | "suspended" | "canceled";

export type MemberSubPill = { featureSlug: string; displayName: string };

export type MemberRow = {
  id: string;
  name: string;
  locationId: string;
  subs: MemberSubPill[];
  bundleSlug: "bundle-plus" | "bundle-pro" | null;
  walletBalance: number;
  planFit: PlanFit;
  revenueCents: number;
  marginCents: number;
  status: MemberStatus;
  flags: MemberFlag[];
};

export type MembersListData = {
  rows: MemberRow[];
  counts: Record<MemberFlag, number>;
};

function deriveStatus(userStatus: string, subStatuses: string[]): MemberStatus {
  if (userStatus === "suspended") return "suspended";
  if (subStatuses.some((s) => s === "past_due")) return "past_due";
  if (userStatus === "inactive" || (subStatuses.length > 0 && subStatuses.every((s) => s === "canceled"))) return "canceled";
  return "active";
}

export async function getAdminMembersList(search: string, db: PrismaClient = defaultPrisma): Promise<MembersListData> {
  const now = new Date();

  const users = await db.user.findMany({
    where: {
      role: { not: "admin" },
      OR: [{ subscriptions: { some: {} } }, { wallet: { isNot: null } }, { ledgerEntries: { some: {} } }, { toolUses: { some: {} } }],
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { ghlLocationId: { contains: search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    },
    include: {
      wallet: { select: { balance: true } },
      subscriptions: { include: { tier: { include: { feature: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const userIds = users.map((u) => u.id);
  const locationIds = users.map((u) => u.ghlLocationId).filter((id): id is string => !!id);

  const [ledgerEntries, apiCalls, rentcastEcon, allFeatures, upgradeableTiers] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { userId: { in: userIds }, kind: "consumption" },
      select: { userId: true, allowanceCovered: true, createdAt: true, feature: { select: { slug: true } } },
    }),
    locationIds.length
      ? db.apiCall.findMany({
          where: { locationId: { in: locationIds }, isAdmin: false },
          select: { locationId: true, resource: true, costCents: true },
        })
      : Promise.resolve([]),
    getRentcastEconomics(db, now),
    db.feature.findMany({ select: { slug: true, creditCost: true } }),
    // The full tier ladder for every upgrade-path feature — read from the
    // catalog, never hardcoded, so a price/allowance change in Tier rows
    // shows up here automatically.
    db.tier.findMany({
      where: { feature: { slug: { in: Array.from(UPGRADEABLE_FEATURE_SLUGS) } } },
      select: { id: true, level: true, priceCents: true, allowance: true, feature: { select: { slug: true } } },
    }),
  ]);
  const creditCostBySlug = new Map(allFeatures.map((f) => [f.slug, f.creditCost]));

  // Ladder per feature, ranked base -> plus -> pro.
  const tierLadderByFeatureSlug = new Map<string, typeof upgradeableTiers>();
  for (const t of upgradeableTiers) {
    const arr = tierLadderByFeatureSlug.get(t.feature.slug) ?? [];
    arr.push(t);
    tierLadderByFeatureSlug.set(t.feature.slug, arr);
  }
  for (const arr of tierLadderByFeatureSlug.values()) arr.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);

  const ledgerByUser = new Map<string, typeof ledgerEntries>();
  for (const l of ledgerEntries) {
    const arr = ledgerByUser.get(l.userId) ?? [];
    arr.push(l);
    ledgerByUser.set(l.userId, arr);
  }

  const nonRentcastCallsByLocation = new Map<string, { costCents: number | null }[]>();
  const rentcastCallsByLocation = new Map<string, number>();
  for (const c of apiCalls) {
    if (c.resource === RENTCAST_RESOURCE) {
      rentcastCallsByLocation.set(c.locationId, (rentcastCallsByLocation.get(c.locationId) ?? 0) + 1);
    } else {
      const arr = nonRentcastCallsByLocation.get(c.locationId) ?? [];
      arr.push({ costCents: c.costCents });
      nonRentcastCallsByLocation.set(c.locationId, arr);
    }
  }

  // Exact-split the ONE rounded Rentcast total across locations by call
  // count (largest-remainder — see splitIntegerProportional in
  // lib/adminMoney.ts), instead of each location independently
  // Math.round()-ing its own share. Independent per-location rounding is
  // exactly what used to leave sum(member cost) a cent or two off
  // Overview's total cost (and therefore sum(member margin) off Overview's
  // total margin) even after revenue was fixed.
  const rentcastLocationOrder = Array.from(rentcastCallsByLocation.keys());
  const totalRentcastCalls = rentcastLocationOrder.reduce((s, loc) => s + (rentcastCallsByLocation.get(loc) ?? 0), 0);
  const totalRentcastCostCents = Math.round(totalRentcastCalls * rentcastEcon.perCallCostCents);
  const rentcastCostShares = splitIntegerProportional(
    totalRentcastCostCents,
    rentcastLocationOrder.map((loc) => rentcastCallsByLocation.get(loc) ?? 0),
  );
  const rentcastCostByLocation = new Map(rentcastLocationOrder.map((loc, i) => [loc, rentcastCostShares[i]]));

  const rows: MemberRow[] = [];
  const counts: Record<MemberFlag, number> = { past_due: 0, neg_bal: 0, upsell: 0, downsell: 0 };

  for (const u of users) {
    const walletBalance = u.wallet?.balance ?? 0;
    const memberLedger = ledgerByUser.get(u.id) ?? [];

    // --- subscriptions + derived bundle ---
    const subs: MemberSubPill[] = u.subscriptions
      .filter((s) => s.status === "active")
      .map((s) => ({
        featureSlug: s.tier.feature.slug,
        displayName: deriveTierName(s.tier.feature.unifiedName ?? s.tier.feature.slug, s.tier),
      }));
    const tiers: QualifyingTiers = {};
    for (const s of u.subscriptions) {
      if (s.status !== "active") continue;
      const slug = s.tier.feature.slug;
      if (slug !== "score" && slug !== "ask" && slug !== "bots") continue;
      tiers[slug] = s.tier.level;
    }
    const bundleSlug = qualifyBundle(tiers);

    // --- status + payment-needs-fixing flag ---
    const status = deriveStatus(u.status, u.subscriptions.map((s) => s.status));
    const flags: MemberFlag[] = [];
    if (status === "past_due" || status === "suspended") flags.push("past_due");
    if (walletBalance < 0) flags.push("neg_bal");

    // --- plan fit: upsell (upgrading would actually SAVE them money) vs
    // downsell (paying, underusing PAID allowance) ---
    const creditRuns = memberLedger.filter((l) => l.allowanceCovered === false);

    // For each upgrade-path feature: would the NEXT tier cost this member
    // LESS than what they're paying now (current tier price + their credit
    // spend on that tool) once the bigger allowance absorbs more of their
    // usage (any usage still past the next tier's allowance keeps costing
    // credits — "residual" spend)? Never flags a tier change that costs
    // more, and top-tier members have no next tier to check at all.
    const activeSubBySlug = new Map(u.subscriptions.filter((s) => s.status === "active").map((s) => [s.tier.feature.slug, s]));
    let isUpsell = false;
    for (const featureSlug of UPGRADEABLE_FEATURE_SLUGS) {
      const ladder = tierLadderByFeatureSlug.get(featureSlug) ?? [];
      if (ladder.length === 0) continue;
      const activeSub = activeSubBySlug.get(featureSlug);
      const currentTier = activeSub ? ladder.find((t) => t.id === activeSub.tierId) : ladder.find((t) => t.level === "base");
      if (!currentTier) continue;
      const currentRank = LEVEL_RANK[currentTier.level];
      const nextTier = ladder.find((t) => LEVEL_RANK[t.level] === currentRank + 1);
      if (!nextTier) continue; // already on the top tier — never an upsell candidate

      const { periodStart, periodEnd } = activeSub ? { periodStart: activeSub.periodStart, periodEnd: activeSub.periodEnd } : calendarMonthWindow(now);
      const featureLedger = memberLedger.filter((l) => l.feature?.slug === featureSlug && l.createdAt >= periodStart && l.createdAt < periodEnd);
      const totalUsage = featureLedger.length;
      const creditUsage = featureLedger.filter((l) => l.allowanceCovered === false).length;
      const creditCost = creditCostBySlug.get(featureSlug) ?? 1;

      const currentMonthlyCents = currentTier.priceCents + creditRevenueCents(creditUsage, creditCost);
      const residualUsage = nextTier.allowance === null ? 0 : Math.max(0, totalUsage - nextTier.allowance);
      const nextTierMonthlyCents = nextTier.priceCents + creditRevenueCents(residualUsage, creditCost);

      if (nextTierMonthlyCents < currentMonthlyCents) {
        isUpsell = true;
        break;
      }
    }

    // Paid (priceCents > 0) active subs only — a free/core-included base tier
    // (e.g. base Score) never counts toward churn-risk underuse.
    const paidActiveSubs = u.subscriptions.filter((s) => s.status === "active" && s.tier.priceCents > 0 && s.tier.allowance !== null);
    let isDownsell = false;
    if (paidActiveSubs.length > 0 && walletBalance <= DOWNSELL_NEAR_ZERO_CREDITS) {
      isDownsell = paidActiveSubs.every((s) => {
        const allowanceUsed = memberLedger.filter(
          (l) => l.allowanceCovered === true && l.feature?.slug === s.tier.feature.slug && l.createdAt >= s.periodStart && l.createdAt <= s.periodEnd,
        ).length;
        const ratio = s.tier.allowance ? allowanceUsed / s.tier.allowance : 0;
        return ratio < DOWNSELL_ALLOWANCE_USE_THRESHOLD;
      });
    }

    let planFit: PlanFit = "healthy";
    if (isUpsell) {
      planFit = "upsell";
      flags.push("upsell");
    } else if (isDownsell) {
      planFit = "downsell";
      flags.push("downsell");
    }

    // --- revenue: subscription (current-period MRR, same reading Overview/Tools
    // use) + credit (same creditRevenueCents formula, grouped by feature since a
    // member's credit runs can span several features) ---
    const activeSubs = u.subscriptions.filter((s) => s.status === "active");
    const subRevenueCents = activeSubs.reduce((sum, s) => sum + s.tier.priceCents, 0);
    const creditRunsByFeatureSlug = new Map<string, number>();
    for (const l of creditRuns) {
      if (!l.feature?.slug) continue;
      creditRunsByFeatureSlug.set(l.feature.slug, (creditRunsByFeatureSlug.get(l.feature.slug) ?? 0) + 1);
    }
    const memberCreditRevenueCents = Array.from(creditRunsByFeatureSlug.entries()).reduce(
      (sum, [slug, count]) => sum + creditRevenueCents(count, creditCostBySlug.get(slug) ?? 1),
      0,
    );

    // --- cost: non-Rentcast ApiCall.costCents (exact sum) + this location's
    // exact-split share of the one Rentcast total (see rentcastCostByLocation
    // above) — NOT attributedCostCents' own per-call Math.round(), which
    // would reintroduce the same independent-rounding drift. ---
    const locId = u.ghlLocationId ?? "";
    const nonRentcastCostCents = (nonRentcastCallsByLocation.get(locId) ?? []).reduce((sum, c) => sum + (c.costCents ?? 0), 0);
    const totalCostCents = nonRentcastCostCents + (rentcastCostByLocation.get(locId) ?? 0);
    const memberRevenueCents = subRevenueCents + memberCreditRevenueCents;
    const memberMarginCents = memberRevenueCents - totalCostCents;

    for (const f of new Set(flags)) counts[f] += 1;

    rows.push({
      id: u.id,
      name: u.name ?? u.email,
      locationId: u.ghlLocationId ?? "—",
      subs,
      bundleSlug,
      walletBalance,
      planFit,
      revenueCents: memberRevenueCents,
      marginCents: memberMarginCents,
      status,
      flags: Array.from(new Set(flags)),
    });
  }

  return { rows, counts };
}
