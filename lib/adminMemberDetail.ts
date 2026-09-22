// Admin Member Dossier (/admin/members/[id]) data layer — READ-ONLY deep page
// for one member. Reuses, never re-derives: lib/bundleQualify.ts for the
// bundle pill, lib/adminMoney.ts for revenue/cost/margin, and the SAME
// upsell/downsell flag math lib/adminMembersList.ts uses for the roster —
// this member's flags/money here MUST match their row on the Members list
// (and be a correct addend of Overview's all-time/Source=Client total).
//
// Money window: ALL TIME, Source=Client, exactly like the Members list (no
// Range/Source selector on this page) — see lib/adminMembersList.ts's header
// note for why that's the reconciliation baseline.
//
// The per-tool "Tool usage" accordion is a narrower, presentational read: it
// attributes cost via ToolUse.id -> ApiCall.toolUseId (the Tools-page join),
// not via locationId, because it needs a PER-TOOL split, which the
// locationId join can't give you. That's fine — it's a breakdown for display,
// not a reconciliation total (the top Money panel is the one that must add
// up to Overview; see lib/adminMoney.ts's header for why the two joins land
// on the same totals in aggregate anyway).

import { PrismaClient, TierLevel } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { qualifyBundle, type QualifyingTiers } from "@/lib/bundleQualify";
import { deriveTierName } from "@/lib/catalogDerive";
import { getRentcastEconomics, RENTCAST_RESOURCE } from "@/lib/adminDashboard";
import { creditRevenueCents, splitIntegerProportional, attributedCostCents } from "@/lib/adminMoney";
import { getBrandAssets } from "@/lib/brandAssets";
import { brandSlugFor } from "@/lib/brandSlug";
import type { MemberFlag, MemberStatus, PlanFit } from "@/lib/adminMembersList";

// Same as lib/adminMembersList.ts — never re-derive tier ordering elsewhere.
const UPGRADEABLE_FEATURE_SLUGS = new Set(["score", "ask"]);
const LEVEL_RANK: Record<TierLevel, number> = { base: 0, plus: 1, pro: 2 };
const DOWNSELL_ALLOWANCE_USE_THRESHOLD = 0.25;
const DOWNSELL_NEAR_ZERO_CREDITS = 5;
const BOTS_SPLIT_SLUGS = new Set(["acq", "dispo"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function calendarMonthWindow(now: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

function deriveStatus(userStatus: string, subStatuses: string[]): MemberStatus {
  if (userStatus === "suspended") return "suspended";
  if (subStatuses.some((s) => s === "past_due")) return "past_due";
  if (userStatus === "inactive" || (subStatuses.length > 0 && subStatuses.every((s) => s === "canceled"))) return "canceled";
  return "active";
}

export type FlagDetail = { flag: MemberFlag; title: string; detail: string };

export type SubRow = {
  featureSlug: string;
  /** Keys the Phase 3.5 admin proposal cores (lib/engine/adminProposals.ts) — one active row per (userId, featureId). */
  featureId: string;
  tierId: string;
  displayName: string;
  tierLevel: TierLevel;
  priceCents: number;
  wordmark: string;
};

export type LedgerRow = {
  id: string;
  createdAt: string;
  kind: "funding" | "consumption";
  icon: "debit" | "fund" | "adj";
  description: string;
  subDescription: string;
  amount: number; // signed credit delta
  runningBalance: number;
};

export type ToolUsageRow = {
  slug: string;
  name: string;
  wordmark: string;
  live: boolean;
  runs: number;
  costCents: number;
  series: { date: string; runs: number; costCents: number }[];
};

export type PlanFitData = {
  featureSlug: string;
  runsAllowance: number;
  runsTotal: number;
  pctOnCredits: number;
  creditCoveredRuns: number;
  verdict: PlanFit;
  verdictText: string;
  series: { date: string; cumulativeRuns: number; allowance: number | null }[];
};

export type MemberDetailData = {
  id: string;
  name: string;
  locationId: string;
  memberSince: string;
  status: MemberStatus;
  flags: MemberFlag[];
  flagDetails: FlagDetail[];
  wallet: { balance: number };
  subs: SubRow[];
  bundleSlug: "bundle-plus" | "bundle-pro" | null;
  money: { revenueCents: number; costCents: number; marginCents: number };
  planFit: PlanFitData;
  toolUsage: ToolUsageRow[];
  ledger: LedgerRow[];
};

export async function getAdminMemberDetail(userId: string, db: PrismaClient = defaultPrisma): Promise<MemberDetailData | null> {
  const now = new Date();

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      wallet: { select: { balance: true } },
      subscriptions: { include: { tier: { include: { feature: true } } } },
    },
  });
  if (!user || user.role === "admin") return null;

  const locationId = user.ghlLocationId ?? "";

  const [ledgerEntries, apiCalls, rentcastEcon, allFeatures, upgradeableTiers, tools, toolUses] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { userId },
      select: {
        id: true,
        kind: true,
        createdAt: true,
        creditDelta: true,
        reason: true,
        creditPack: { select: { credits: true } },
        toolId: true,
        tool: { select: { name: true, slug: true } },
        featureId: true,
        feature: { select: { slug: true } },
        creditsDebited: true,
        allowanceCovered: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    locationId
      ? db.apiCall.findMany({
          where: { locationId, isAdmin: false },
          select: { toolUseId: true, resource: true, costCents: true, createdAt: true },
        })
      : Promise.resolve([]),
    getRentcastEconomics(db, now),
    db.feature.findMany({ select: { slug: true, creditCost: true } }),
    db.tier.findMany({
      where: { feature: { slug: { in: Array.from(UPGRADEABLE_FEATURE_SLUGS) } } },
      select: { id: true, level: true, priceCents: true, allowance: true, feature: { select: { slug: true } } },
    }),
    db.tool.findMany({ include: { feature: true } }),
    db.toolUse.findMany({
      where: { userId, isAdmin: false },
      select: { id: true, featureSlug: true, kind: true, outcome: true, createdAt: true },
    }),
  ]);

  const creditCostBySlug = new Map(allFeatures.map((f) => [f.slug, f.creditCost]));

  const tierLadderByFeatureSlug = new Map<string, typeof upgradeableTiers>();
  for (const t of upgradeableTiers) {
    const arr = tierLadderByFeatureSlug.get(t.feature.slug) ?? [];
    arr.push(t);
    tierLadderByFeatureSlug.set(t.feature.slug, arr);
  }
  for (const arr of tierLadderByFeatureSlug.values()) arr.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);

  const walletBalance = user.wallet?.balance ?? 0;
  const consumptionLedger = ledgerEntries.filter((l) => l.kind === "consumption");

  // --- subscriptions + derived bundle ---
  const subs: SubRow[] = user.subscriptions
    .filter((s) => s.status === "active")
    .map((s) => ({
      featureSlug: s.tier.feature.slug,
      featureId: s.featureId,
      tierId: s.tierId,
      displayName: deriveTierName(s.tier.feature.unifiedName ?? s.tier.feature.slug, s.tier),
      tierLevel: s.tier.level,
      priceCents: s.tier.priceCents,
      wordmark: getBrandAssets(brandSlugFor(s.tier.feature.slug)).wordmark,
    }));
  const tiers: QualifyingTiers = {};
  for (const s of user.subscriptions) {
    if (s.status !== "active") continue;
    const slug = s.tier.feature.slug;
    if (slug !== "score" && slug !== "ask" && slug !== "bots") continue;
    tiers[slug] = s.tier.level;
  }
  const bundleSlug = qualifyBundle(tiers);

  // --- status + flags ---
  const status = deriveStatus(user.status, user.subscriptions.map((s) => s.status));
  const flags: MemberFlag[] = [];
  const flagDetails: FlagDetail[] = [];
  if (status === "past_due" || status === "suspended") {
    flags.push("past_due");
    flagDetails.push({
      flag: "past_due",
      title: "Payment needs fixing",
      detail: status === "suspended" ? "Account suspended — payment issue or violation." : "Subscription is past due — recover before they lapse.",
    });
  }
  if (walletBalance < 0) {
    flags.push("neg_bal");
    flagDetails.push({ flag: "neg_bal", title: "Negative balance", detail: `Credit balance is ${walletBalance} — a money leak, investigate.` });
  }

  // --- plan fit: same upsell math as lib/adminMembersList.ts, kept per-feature so we can surface the winning feature's numbers ---
  const activeSubBySlug = new Map(user.subscriptions.filter((s) => s.status === "active").map((s) => [s.tier.feature.slug, s]));
  let upsellFeatureSlug: string | null = null;
  let upsellDetail = "";
  for (const featureSlug of UPGRADEABLE_FEATURE_SLUGS) {
    const ladder = tierLadderByFeatureSlug.get(featureSlug) ?? [];
    if (ladder.length === 0) continue;
    const activeSub = activeSubBySlug.get(featureSlug);
    const currentTier = activeSub ? ladder.find((t) => t.id === activeSub.tierId) : ladder.find((t) => t.level === "base");
    if (!currentTier) continue;
    const currentRank = LEVEL_RANK[currentTier.level];
    const nextTier = ladder.find((t) => LEVEL_RANK[t.level] === currentRank + 1);
    if (!nextTier) continue;

    const { periodStart, periodEnd } = activeSub ? { periodStart: activeSub.periodStart, periodEnd: activeSub.periodEnd } : calendarMonthWindow(now);
    const featureLedger = consumptionLedger.filter((l) => l.feature?.slug === featureSlug && l.createdAt >= periodStart && l.createdAt < periodEnd);
    const totalUsage = featureLedger.length;
    const creditUsage = featureLedger.filter((l) => l.allowanceCovered === false).length;
    const creditCost = creditCostBySlug.get(featureSlug) ?? 1;

    const currentMonthlyCents = currentTier.priceCents + creditRevenueCents(creditUsage, creditCost);
    const residualUsage = nextTier.allowance === null ? 0 : Math.max(0, totalUsage - nextTier.allowance);
    const nextTierMonthlyCents = nextTier.priceCents + creditRevenueCents(residualUsage, creditCost);

    if (nextTierMonthlyCents < currentMonthlyCents) {
      upsellFeatureSlug = featureSlug;
      const savedCents = currentMonthlyCents - nextTierMonthlyCents;
      upsellDetail = `Spending on ${featureSlug} overage this cycle — the next tier would cost them ${(savedCents / 100).toFixed(2)}/mo less ($${(currentMonthlyCents / 100).toFixed(2)} → $${(nextTierMonthlyCents / 100).toFixed(2)}).`;
      break;
    }
  }
  const isUpsell = upsellFeatureSlug !== null;

  const paidActiveSubs = user.subscriptions.filter((s) => s.status === "active" && s.tier.priceCents > 0 && s.tier.allowance !== null);
  let downsellFeatureSlug: string | null = null;
  if (paidActiveSubs.length > 0 && walletBalance <= DOWNSELL_NEAR_ZERO_CREDITS) {
    const allDownsell = paidActiveSubs.every((s) => {
      const allowanceUsed = consumptionLedger.filter(
        (l) => l.allowanceCovered === true && l.feature?.slug === s.tier.feature.slug && l.createdAt >= s.periodStart && l.createdAt <= s.periodEnd,
      ).length;
      const ratio = s.tier.allowance ? allowanceUsed / s.tier.allowance : 0;
      return ratio < DOWNSELL_ALLOWANCE_USE_THRESHOLD;
    });
    if (allDownsell) downsellFeatureSlug = paidActiveSubs[0].tier.feature.slug;
  }
  const isDownsell = downsellFeatureSlug !== null;

  let planFitVerdict: PlanFit = "healthy";
  if (isUpsell) {
    planFitVerdict = "upsell";
    flags.push("upsell");
    flagDetails.push({ flag: "upsell", title: "Upsell candidate", detail: upsellDetail });
  } else if (isDownsell) {
    planFitVerdict = "downsell";
    flags.push("downsell");
    flagDetails.push({
      flag: "downsell",
      title: "Churn risk · save",
      detail: `Paying for ${downsellFeatureSlug}, using under 25% of allowance this cycle — a downgrade beats losing them to cancellation.`,
    });
  }

  // --- plan-fit panel numbers, scoped to the winning feature (or the first paid sub if healthy) ---
  const fitFeatureSlug = upsellFeatureSlug ?? downsellFeatureSlug ?? paidActiveSubs[0]?.tier.feature.slug ?? subs[0]?.featureSlug ?? "score";
  const fitSub = activeSubBySlug.get(fitFeatureSlug);
  const fitAllowance = fitSub?.tier.allowance ?? null;
  const { periodStart: fitPeriodStart, periodEnd: fitPeriodEnd } = fitSub
    ? { periodStart: fitSub.periodStart, periodEnd: fitSub.periodEnd }
    : calendarMonthWindow(now);
  const fitLedger = consumptionLedger
    .filter((l) => l.feature?.slug === fitFeatureSlug && l.createdAt >= fitPeriodStart && l.createdAt < fitPeriodEnd)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const fitTotalRuns = fitLedger.length;
  const fitCreditRuns = fitLedger.filter((l) => l.allowanceCovered === false).length;
  const fitAllowanceRuns = fitAllowance !== null ? Math.min(fitTotalRuns, fitAllowance) : fitTotalRuns;
  const pctOnCredits = fitTotalRuns > 0 ? Math.round((fitCreditRuns / fitTotalRuns) * 100) : 0;

  const fitDays: string[] = [];
  for (let t = fitPeriodStart.getTime(); t <= Math.min(fitPeriodEnd.getTime(), now.getTime()); t += DAY_MS) {
    fitDays.push(new Date(t).toISOString().slice(0, 10));
  }
  if (fitDays.length === 0) fitDays.push(fitPeriodStart.toISOString().slice(0, 10));
  const fitSeries = fitDays.map((date) => ({ date, cumulativeRuns: 0, allowance: fitAllowance }));
  {
    const perDay = new Map<string, number>();
    for (const l of fitLedger) {
      const key = l.createdAt.toISOString().slice(0, 10);
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    let running = 0;
    for (const p of fitSeries) {
      running += perDay.get(p.date) ?? 0;
      p.cumulativeRuns = running;
    }
  }

  let verdictText: string;
  if (isUpsell) {
    verdictText = `Upsell. ${upsellDetail}`;
  } else if (isDownsell) {
    verdictText = `Churn risk. Paying for ${downsellFeatureSlug}, but only used ${fitAllowanceRuns} of ${fitAllowance ?? "their"} allowance this cycle — a downgrade beats losing them outright.`;
  } else {
    verdictText = `Healthy. ${fitFeatureSlug} usage tracks their plan — ${fitTotalRuns} run${fitTotalRuns === 1 ? "" : "s"} this cycle, ${pctOnCredits}% on credits.`;
  }

  const planFit: PlanFitData = {
    featureSlug: fitFeatureSlug,
    runsAllowance: fitAllowanceRuns,
    runsTotal: fitTotalRuns,
    pctOnCredits,
    creditCoveredRuns: fitCreditRuns,
    verdict: planFitVerdict,
    verdictText,
    series: fitSeries,
  };

  // --- money: MUST reconcile with lib/adminMembersList.ts's per-member reading ---
  const activeSubs = user.subscriptions.filter((s) => s.status === "active");
  const subRevenueCents = activeSubs.reduce((sum, s) => sum + s.tier.priceCents, 0);
  const creditRuns = consumptionLedger.filter((l) => l.allowanceCovered === false);
  const creditRunsByFeatureSlug = new Map<string, number>();
  for (const l of creditRuns) {
    if (!l.feature?.slug) continue;
    creditRunsByFeatureSlug.set(l.feature.slug, (creditRunsByFeatureSlug.get(l.feature.slug) ?? 0) + 1);
  }
  const memberCreditRevenueCents = Array.from(creditRunsByFeatureSlug.entries()).reduce(
    (sum, [slug, count]) => sum + creditRevenueCents(count, creditCostBySlug.get(slug) ?? 1),
    0,
  );
  const memberRevenueCents = subRevenueCents + memberCreditRevenueCents;

  const nonRentcastCalls = apiCalls.filter((c) => c.resource !== RENTCAST_RESOURCE);
  const rentcastCallCount = apiCalls.length - nonRentcastCalls.length;
  const nonRentcastCostCents = nonRentcastCalls.reduce((sum, c) => sum + (c.costCents ?? 0), 0);
  // A single-location split is the degenerate one-weight case of the same
  // largest-remainder split lib/adminMembersList.ts uses across locations —
  // for one member it's just the full rounded Rentcast share for their calls.
  const [rentcastCostCents] = rentcastCallCount > 0 ? splitIntegerProportional(Math.round(rentcastCallCount * rentcastEcon.perCallCostCents), [1]) : [0];
  const totalCostCents = nonRentcastCostCents + rentcastCostCents;
  const memberMarginCents = memberRevenueCents - totalCostCents;

  // --- tool usage accordion: per-tool runs/cost, scoped to this member, cost joined via toolUseId (Tools-page pattern) ---
  const apiCallsByToolUseId = new Map<string, { resource: string; costCents: number | null; createdAt: Date }[]>();
  for (const c of apiCalls) {
    if (!c.toolUseId) continue;
    const arr = apiCallsByToolUseId.get(c.toolUseId) ?? [];
    arr.push(c);
    apiCallsByToolUseId.set(c.toolUseId, arr);
  }
  function runsForTool(t: (typeof tools)[number]) {
    return BOTS_SPLIT_SLUGS.has(t.slug) ? toolUses.filter((r) => r.featureSlug === "bots" && r.kind === t.slug) : toolUses.filter((r) => r.featureSlug === t.feature.slug);
  }
  const toolUsage: ToolUsageRow[] = tools.map((t) => {
    const runs = runsForTool(t);
    const calls = runs.flatMap((r) => apiCallsByToolUseId.get(r.id) ?? []);
    const costable = calls.filter((c) => c.resource !== RENTCAST_RESOURCE);
    const rentcastCalls = calls.filter((c) => c.resource === RENTCAST_RESOURCE);
    const { totalCostCents: toolCost } = attributedCostCents(costable, rentcastCalls.length, rentcastEcon.perCallCostCents);

    const byDay = new Map<string, { runs: number; costCents: number }>();
    for (const r of runs) {
      const key = r.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { runs: 0, costCents: 0 };
      entry.runs += 1;
      byDay.set(key, entry);
    }
    for (const c of costable) {
      if (c.costCents === null) continue;
      const key = c.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { runs: 0, costCents: 0 };
      entry.costCents += c.costCents;
      byDay.set(key, entry);
    }
    const series = Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({ date, ...v }));

    return {
      slug: t.slug,
      name: t.name,
      wordmark: getBrandAssets(brandSlugFor(t.slug)).wordmark,
      live: t.active || runs.length > 0,
      runs: runs.length,
      costCents: toolCost,
      series,
    };
  });

  // --- ledger: real transaction history with running balance ---
  let running = 0;
  const ledgerAscending: LedgerRow[] = ledgerEntries.map((l) => {
    running += l.creditDelta;
    let description: string;
    let subDescription: string;
    let icon: LedgerRow["icon"];
    if (l.kind === "funding") {
      icon = l.reason === "adjustment" ? "adj" : "fund";
      if (l.creditPack) {
        description = `Credit pack — ${l.creditPack.credits}`;
        subDescription = "pack_purchase";
      } else {
        description = l.reason === "adjustment" ? "Promo credit" : l.reason === "tier_grant" ? "Plan allowance grant" : l.reason === "bundle_grant" ? "Bundle allowance grant" : "Funding";
        subDescription = l.reason ?? "funding";
      }
    } else {
      icon = "debit";
      description = l.tool?.name ?? l.feature?.slug ?? "Tool run";
      subDescription = l.allowanceCovered === false ? `credit-covered · ${l.creditsDebited ?? 0} credits` : `allowance-covered`;
    }
    return {
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      kind: l.kind,
      icon,
      description,
      subDescription,
      amount: l.creditDelta,
      runningBalance: running,
    };
  });
  const ledger = ledgerAscending.slice().reverse();

  return {
    id: user.id,
    name: user.name ?? user.email,
    locationId: user.ghlLocationId ?? "—",
    memberSince: user.createdAt.toISOString(),
    status,
    flags: Array.from(new Set(flags)),
    flagDetails,
    wallet: { balance: walletBalance },
    subs,
    bundleSlug,
    money: { revenueCents: memberRevenueCents, costCents: totalCostCents, marginCents: memberMarginCents },
    planFit,
    toolUsage,
    ledger,
  };
}
