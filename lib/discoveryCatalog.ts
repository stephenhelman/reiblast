// Discovery's data path — catalog-render ONLY. No member, no resolveFeature,
// no isEntitled, no wallet: there is no logged-in user pre-a2p, so there is
// nothing to resolve per-user. Every product is just active vs coming-soon.
// Public data (no session gate needed), so this always reads Prisma directly —
// no preview-mock fallback like the launcher/store accessors need.

import { prisma } from "@/lib/prisma";
import { brandSlugFor } from "@/lib/brandSlug";
import { deriveBundleCoverage } from "@/lib/catalogDerive";
import { hasHigherTier } from "@/lib/entitlement";
import { STORE_ADDON_SERVICES, STORE_TOOL_COPY } from "@/config/storeCopy";
import type { DiscoveryBundlingTier, DiscoveryCatalog, DiscoveryTool } from "@/types/discovery";

export async function getDiscoveryCatalog(): Promise<DiscoveryCatalog> {
  const [tools, bundles] = await Promise.all([
    prisma.tool.findMany({
      include: { feature: { include: { tiers: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bundle.findMany({
      include: { tiers: { include: { tier: { include: { feature: { include: { surfaces: true } } } } } } },
      orderBy: { priceCents: "asc" },
    }),
  ]);

  const discoveryTools: DiscoveryTool[] = await Promise.all(
    tools.map(async (tool) => {
      const copy = STORE_TOOL_COPY[tool.slug];
      if (!copy) throw new Error(`discoveryCatalog: no STORE_TOOL_COPY entry for DB tool slug "${tool.slug}"`);

      const baseTier = tool.feature.tiers.find((tier) => tier.level === "base");
      // No member pre-a2p — "current level" is always base, so this asks the
      // one question discovery needs: does this feature have ANY rung above base.
      const higherTier = await hasHigherTier(prisma, tool.feature.slug, "base");

      return {
        id: tool.id,
        slug: tool.slug,
        brandSlug: brandSlugFor(tool.slug),
        name: tool.name,
        tagline: copy.tagline,
        hook: copy.hook,
        compareCopy: copy.compareCopy,
        unit: tool.unit,
        featureSlug: tool.feature.slug,
        status: tool.active ? "active" : "coming-soon",
        bucket: tool.feature.bucket,
        basePriceCents: baseTier?.priceCents ?? 0,
        hasHigherTier: higherTier,
      };
    }),
  );

  // REItools is ONE product with a tier ladder (base = included in REIblast;
  // Plus/Pro = the two paid bundle rows) — collapsed into a single bundling
  // card, never rendered as two separate "REItools" cards.
  const bundlingTiers: DiscoveryBundlingTier[] = bundles.map((bundle) => ({
    level: bundle.level,
    name: bundle.name,
    includedToolNames: Array.from(
      new Set(bundle.tiers.flatMap((bt) => bt.tier.feature.surfaces.map((tool) => tool.name))),
    ),
  }));

  // Umbrella status: active only once EVERY tool either paid tier covers is
  // live, so the ladder shown in the modal is real and working, not aspirational.
  const bundlingAvailable = bundles.length > 0 && bundles.every((bundle) => deriveBundleCoverage(bundle).available);

  return {
    tools: discoveryTools,
    bundling: { status: bundlingAvailable ? "active" : "coming-soon", tiers: bundlingTiers },
    addons: STORE_ADDON_SERVICES,
  };
}
