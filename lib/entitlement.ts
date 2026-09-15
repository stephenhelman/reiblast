// Thin entitlement check sitting BESIDE lib/engine/resolver.ts, not inside it —
// the resolver answers "what level/allowance applies" (falling through to a
// feature's base tier when nothing covers it); it can't by itself say whether
// that fallback was a real base-tier ENTITLEMENT (core_included features:
// Score/Scrub, granted by membership) or a paid base tier the member simply
// hasn't subscribed to (addon features: pack/ask/bots). This fills that gap
// without touching resolver.ts.

import type { Feature, PrismaClient, TierLevel } from "@prisma/client";
import { qualifyBundle, type QualifyingTiers } from "@/lib/bundleQualify";

const TIER_LEVEL_ORDER: TierLevel[] = ["base", "plus", "pro"];

export async function isEntitled(
  prisma: PrismaClient,
  userId: string,
  feature: Pick<Feature, "id" | "bucket">,
): Promise<boolean> {
  // Core-included features are granted by membership, not a subscription row —
  // the resolver's base-tier fallthrough IS the entitlement.
  if (feature.bucket === "core_included") return true;

  // Every active sub is a tool_sub now — bundle membership is derived, never
  // stored (see lib/bundleQualify.ts), so the resolver's own tool_sub walk
  // already covers what the old bundle branch here duplicated.
  const activeSubs = await prisma.subscription.findMany({
    where: { userId, status: "active" },
    include: { tier: true },
  });

  return activeSubs.some((sub) => sub.tier.featureId === feature.id);
}

/**
 * The store's "Your current plan" bundle highlight — a display-only lookup,
 * not an entitlement/allowance decision (that's still resolveFeature's job
 * per feature). Derives the qualifying bundle from the member's active
 * tool_subs via qualifyBundle() — there is no stored bundle row anymore.
 * Return shape unchanged (string | null) so callers don't need to change.
 */
export async function getCurrentBundleSlug(
  prisma: PrismaClient,
  userId: string,
): Promise<string | null> {
  const activeSubs = await prisma.subscription.findMany({
    where: { userId, status: "active" },
    include: { tier: { include: { feature: true } } },
  });

  const tiers: QualifyingTiers = {};
  for (const sub of activeSubs) {
    const slug = sub.tier.feature.slug;
    if (slug !== "score" && slug !== "ask" && slug !== "bots") continue;
    const current = tiers[slug];
    if (!current || TIER_LEVEL_ORDER.indexOf(sub.tier.level) > TIER_LEVEL_ORDER.indexOf(current)) {
      tiers[slug] = sub.tier.level;
    }
  }

  return qualifyBundle(tiers);
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
