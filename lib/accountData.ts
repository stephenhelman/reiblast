// The account/wallet surface's data path — parallel to lib/launcherCatalog.ts
// and lib/storeCatalog.ts, same engine tables. Read-only: this file never
// writes to Wallet/LedgerEntry/Subscription.
//
// Vendor cost is admin-eyes only and lives on ApiCall.costCents now, not on
// LedgerEntry — it was never selectable from this client-eyes surface even
// before the column moved, and still isn't.

import type { FundingReason, PrismaClient, Subscription, Tier, TierLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveSessionUserId } from "@/lib/toolsSession";
import { resolveFeature } from "@/lib/engine/resolver";
import { getCurrentBundleSlug } from "@/lib/entitlement";
import { brandSlugFor } from "@/lib/brandSlug";
import { deriveTierName } from "@/lib/catalogDerive";
import { mockAccountData } from "@/config/account.mock";
import type {
  AccountData,
  AccountDowngradeTarget,
  AccountLedgerRow,
  AccountMeteredFeature,
  AccountSubscription,
  LedgerRowKind,
} from "@/types/account";

const FUNDING_REASON_LABEL: Record<FundingReason, string> = {
  pack_purchase: "Credit pack purchase",
  tier_grant: "Plan grant",
  bundle_grant: "Bundle grant",
  adjustment: "Adjustment",
};

type FeatureWithSurfaces = { unifiedName: string | null; surfaces: { name: string; unit: string }[] };
type SubWithTier = Subscription & { tier: Tier & { feature: FeatureWithSurfaces } };

const TIER_LEVEL_ORDER: TierLevel[] = ["base", "plus", "pro"];

// One lower-level Tier per active line's feature, keyed by Subscription.id —
// phase 3's downgrade target. Fetched in one query per page load (not N+1)
// against the small set of features the member actually holds.
async function computeDowngradeTargets(
  client: PrismaClient,
  subs: SubWithTier[],
): Promise<Map<string, AccountDowngradeTarget>> {
  const featureIds = [...new Set(subs.map((s) => s.featureId))];
  if (featureIds.length === 0) return new Map();

  const tiers = await client.tier.findMany({ where: { featureId: { in: featureIds } } });
  const byFeature = new Map<string, Tier[]>();
  for (const tier of tiers) {
    const list = byFeature.get(tier.featureId) ?? [];
    list.push(tier);
    byFeature.set(tier.featureId, list);
  }

  const result = new Map<string, AccountDowngradeTarget>();
  for (const sub of subs) {
    const currentIdx = TIER_LEVEL_ORDER.indexOf(sub.tier.level);
    if (currentIdx <= 0) continue; // already at the lowest tier — no downgrade target
    const lowerLevel = TIER_LEVEL_ORDER[currentIdx - 1];
    const lowerTier = byFeature.get(sub.featureId)?.find((t) => t.level === lowerLevel);
    if (!lowerTier) continue;

    const toolName = sub.tier.feature.surfaces[0]?.name ?? sub.tier.feature.unifiedName ?? "Tool";
    result.set(sub.id, {
      tierId: lowerTier.id,
      displayName: deriveTierName(toolName, lowerTier),
      priceCents: lowerTier.priceCents,
    });
  }
  return result;
}

// Every row is a tool_sub now — bundle membership is derived (see
// getCurrentBundleSlug), never stored, so a bundle member shows as their N
// individual tool_sub lines. AccountData.currentBundleSlug (set in
// getRealAccountData below) carries the "part of Bundle Pro" grouping
// separately, for a caller that wants to label these lines together without
// needing a fake per-row bundle kind.
function buildSubscription(sub: SubWithTier, downgradeTarget: AccountDowngradeTarget | null): AccountSubscription {
  const toolName = sub.tier.feature.surfaces[0]?.name ?? sub.tier.feature.unifiedName ?? "Tool";
  const name = deriveTierName(toolName, sub.tier);
  const allowanceText = sub.tier.allowance === null ? "Unlimited" : `${sub.tier.allowance}`;
  return {
    id: sub.id,
    kind: "tool_sub",
    featureId: sub.featureId,
    displayName: name,
    grants: [`${allowanceText} included this period`],
    status: sub.status,
    periodEnd: sub.periodEnd.toISOString(),
    downgradeTarget,
  };
}

async function buildMeteredFeatures(prisma: PrismaClient, userId: string): Promise<AccountMeteredFeature[]> {
  // Active + per_cycle-metered surfaces only — at launch this is Score alone
  // (scrub is meteringShape "none"; pack/ask/bots are inactive). Generic on
  // purpose so a future activation picks this up with no code change here.
  const tools = await prisma.tool.findMany({
    where: { active: true, feature: { meteringShape: "per_cycle" } },
    include: { feature: true },
  });

  const results: AccountMeteredFeature[] = [];
  for (const tool of tools) {
    const resolved = await resolveFeature(prisma, userId, tool.feature.slug);
    if (resolved.allowance === null) continue; // unlimited — nothing to meter
    results.push({
      featureSlug: tool.feature.slug,
      toolName: tool.name,
      unit: tool.unit,
      used: resolved.used,
      allowance: resolved.allowance,
      periodEnd: resolved.periodEnd.toISOString(),
    });
  }
  return results;
}

function classifyRow(entry: {
  kind: "funding" | "consumption";
  creditDelta: number;
  creditsDebited: number | null;
  allowanceCovered: boolean | null;
}): LedgerRowKind {
  if (entry.kind === "funding") return "funding";
  if (entry.allowanceCovered) return "allowance-covered";
  return "credit-debit";
}

/** Default-view predicate (Zone 3): funding, or consumption debits — excludes allowance-covered rows. */
export function isCreditsOnlyRow(row: Pick<AccountLedgerRow, "kind">): boolean {
  return row.kind !== "allowance-covered";
}

async function buildLedger(prisma: PrismaClient, userId: string): Promise<AccountLedgerRow[]> {
  // Full history, ascending, to compute a correct running balance — filters
  // are applied client-side against this fully-materialized+balanced array,
  // never against a re-queried subset (that would silently sum the subset).
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      creditDelta: true,
      createdAt: true,
      reason: true,
      refId: true,
      creditPack: { select: { slug: true } },
      tool: { select: { slug: true, name: true, unit: true } },
      feature: { select: { slug: true } },
      unitCount: true,
      creditsDebited: true,
      allowanceCovered: true,
      outcome: true,
    },
  });

  let running = 0;
  const rows: AccountLedgerRow[] = [];
  for (const e of entries) {
    running += e.creditDelta;
    const kind = classifyRow(e);
    const toolBrandSlug = e.tool ? brandSlugFor(e.tool.slug) : null;
    const activityLabel = e.tool && e.unitCount ? `${e.unitCount} ${e.tool.unit}` : null;
    const reasonLabel =
      e.kind === "funding" && e.reason
        ? e.creditPack
          ? `${FUNDING_REASON_LABEL[e.reason]} (${e.creditPack.slug})`
          : FUNDING_REASON_LABEL[e.reason]
        : null;

    rows.push({
      id: e.id,
      kind,
      createdAt: e.createdAt.toISOString(),
      toolBrandSlug,
      toolName: e.tool?.name ?? null,
      activityLabel,
      reasonLabel,
      refId: e.refId,
      featureSlug: e.feature?.slug ?? null,
      outcome: e.outcome,
      allowanceCovered: e.allowanceCovered ?? false,
      creditDelta: e.creditDelta,
      balanceAfter: running,
      searchText: [e.tool?.name, reasonLabel, e.refId].filter(Boolean).join(" ").toLowerCase(),
    });
  }

  return rows.reverse(); // most-recent-first for display
}

async function getRealAccountData(userId: string, client: PrismaClient): Promise<AccountData> {
  const [user, wallet, subs, currentBundleSlug] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: userId } }),
    client.wallet.findUnique({ where: { userId } }),
    client.subscription.findMany({
      where: { userId, status: { in: ["active", "past_due"] } },
      include: { tier: { include: { feature: { include: { surfaces: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    getCurrentBundleSlug(client, userId),
  ]);

  const [meteredFeatures, ledger, downgradeTargets] = await Promise.all([
    buildMeteredFeatures(client, userId),
    buildLedger(client, userId),
    computeDowngradeTargets(client, subs),
  ]);

  return {
    currentBundleSlug,
    member: {
      id: user.id,
      name: user.name ?? user.email,
      email: user.email,
      walletBalance: wallet?.balance ?? 0,
    },
    meteredFeatures,
    subscriptions: subs.map((sub) => buildSubscription(sub, downgradeTargets.get(sub.id) ?? null)),
    ledger,
  };
}

export async function getAccountData(): Promise<AccountData> {
  const userId = await resolveSessionUserId(prisma);

  // PREVIEW-ONLY FALLBACK — same gate as lib/launcherCatalog.ts /
  // lib/storeCatalog.ts. Never substitutes for the session check; middleware
  // still requires a verified session cookie to reach any tools route.
  const previewMockEnabled =
    process.env.NODE_ENV !== "production" && process.env.TOOLS_PREVIEW_MOCK_MEMBER === "1";

  if (!userId) {
    if (previewMockEnabled) return mockAccountData;
    throw new Error(
      "getAccountData(): no resolved member session, and TOOLS_PREVIEW_MOCK_MEMBER preview fallback is not enabled.",
    );
  }

  return getRealAccountData(userId, prisma);
}
