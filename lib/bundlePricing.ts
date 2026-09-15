// FORWARD direction, mirroring lib/bundleQualify.ts's reverse direction:
// qualifyBundle answers "which bundle do these tiers qualify for"; this file
// answers "what are the priced tool_sub lines that make up a given bundle."
// checkout.ts and app/api/webhooks/stripe/route.ts both read
// resolveStripePriceId — one price-resolution rule, never two that can drift.

import type { PrismaClient, TierLevel } from '@prisma/client'

export type PrismaOrTx = Pick<PrismaClient, 'tier' | 'bundlePriceOverride' | 'bundle'>

// Override-first-else-à-la-carte: a BundlePriceOverride row only exists where
// the in-bundle price differs from the tier's own à-la-carte Price. No row ->
// the tier's own stripePriceId (possibly itself null, e.g. score/base).
export async function resolveStripePriceId(
  client: PrismaOrTx,
  params: { featureId: string; level: TierLevel; bundleSlug?: string | null },
): Promise<string | null> {
  const { featureId, level, bundleSlug } = params

  if (bundleSlug) {
    const override = await client.bundlePriceOverride.findUnique({
      where: { featureId_level_bundleSlug: { featureId, level, bundleSlug } },
    })
    if (override) return override.stripePriceId
  }

  const tier = await client.tier.findUniqueOrThrow({ where: { featureId_level: { featureId, level } } })
  return tier.stripePriceId
}

export interface BundleLine {
  featureSlug: string
  level: TierLevel
  tierId: string
  stripePriceId: string | null
}

// Reads the bundle's real BundleTier rows (never a hardcoded per-bundle
// list) so composition always matches lib/bundleQualify.ts's own contract.
// Pack is never a line here — it's a granted perk, not a tool_sub.
export async function composeBundleLines(
  client: Pick<PrismaClient, 'bundle' | 'bundlePriceOverride' | 'tier'>,
  bundleSlug: string,
): Promise<BundleLine[]> {
  const bundle = await client.bundle.findUniqueOrThrow({
    where: { slug: bundleSlug },
    include: { tiers: { include: { tier: { include: { feature: true } } } } },
  })

  return Promise.all(
    bundle.tiers.map(async (bt) => {
      const stripePriceId = await resolveStripePriceId(client, {
        featureId: bt.tier.featureId,
        level: bt.tier.level,
        bundleSlug,
      })
      return {
        featureSlug: bt.tier.feature.slug,
        level: bt.tier.level,
        tierId: bt.tier.id,
        stripePriceId,
      }
    }),
  )
}
