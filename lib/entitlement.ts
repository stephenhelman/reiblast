// Thin entitlement check sitting BESIDE lib/engine/resolver.ts, not inside it —
// the resolver answers "what level/allowance applies" (falling through to a
// feature's base tier when nothing covers it); it can't by itself say whether
// that fallback was a real base-tier ENTITLEMENT (core_included features:
// Score/Scrub, granted by membership) or a paid base tier the member simply
// hasn't subscribed to (addon features: pack/ask/bots). This fills that gap
// without touching resolver.ts.

import type { BundleLevel, Feature, PrismaClient, TierLevel } from "@prisma/client";

const BUNDLE_LEVEL_ORDER: BundleLevel[] = ["plus", "pro"];
const TIER_LEVEL_ORDER: TierLevel[] = ["base", "plus", "pro"];

export async function isEntitled(
  prisma: PrismaClient,
  userId: string,
  feature: Pick<Feature, "id" | "bucket">,
): Promise<boolean> {
  // Core-included features are granted by membership, not a subscription row —
  // the resolver's base-tier fallthrough IS the entitlement.
  if (feature.bucket === "core_included") return true;

  const activeSubs = await prisma.subscription.findMany({
    where: { userId, status: "active" },
    include: {
      tier: true,
      bundle: { include: { tiers: { include: { tier: true } } } },
    },
  });

  for (const sub of activeSubs) {
    if (sub.type === "tool_sub" && sub.tier?.featureId === feature.id) return true;
    if (sub.type === "bundle" && sub.bundle) {
      for (const bundleTier of sub.bundle.tiers) {
        if (bundleTier.tier.featureId === feature.id) return true;
      }
    }
  }

  return false;
}

/**
 * The store's "Your current plan" bundle highlight — a display-only lookup,
 * not an entitlement/allowance decision (that's still resolveFeature's job
 * per feature). Replace-not-stack means at most one bundle sub should ever be
 * active; if the table is ever messy, highest level wins rather than throwing.
 */
export async function getCurrentBundleSlug(
  prisma: PrismaClient,
  userId: string,
): Promise<string | null> {
  const activeBundleSubs = await prisma.subscription.findMany({
    where: { userId, status: "active", type: "bundle" },
    include: { bundle: true },
  });

  let winner: { slug: string; level: BundleLevel } | null = null;
  for (const sub of activeBundleSubs) {
    if (!sub.bundle) continue;
    if (!winner || BUNDLE_LEVEL_ORDER.indexOf(sub.bundle.level) > BUNDLE_LEVEL_ORDER.indexOf(winner.level)) {
      winner = { slug: sub.bundle.slug, level: sub.bundle.level };
    }
  }

  return winner?.slug ?? null;
}

/**
 * "Upgrade" honesty check, beside isEntitled/getCurrentBundleSlug — true only
 * if the feature has a Tier row strictly above currentLevel. A bundle only
 * lowers price at the same allowance; it is never a substitute for this.
 * Forward-compatible by construction: if a rung above 'pro' is ever added,
 * this picks it up with no code change (TIER_LEVEL_ORDER just grows).
 */
export async function hasHigherTier(
  prisma: PrismaClient,
  featureSlug: string,
  currentLevel: TierLevel,
): Promise<boolean> {
  const higherLevels = TIER_LEVEL_ORDER.slice(TIER_LEVEL_ORDER.indexOf(currentLevel) + 1);
  if (higherLevels.length === 0) return false;

  const count = await prisma.tier.count({
    where: { feature: { slug: featureSlug }, level: { in: higherLevels } },
  });
  return count > 0;
}
