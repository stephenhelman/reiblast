// Pure catalog-shape derivations shared by every engine-backed accessor
// (launcher, store, discovery). No I/O — callers pass in what they already
// fetched. Extracted out of lib/storeCatalog.ts so lib/discoveryCatalog.ts
// doesn't fork its own copy of tier-naming/bundle-coverage math.

import type { Bundle as PrismaBundle, BundleTier, Feature, Tier, Tool as PrismaTool } from "@prisma/client";

/** iPhone-style ladder (sprint doc §5): base -> bare name, plus -> "+", pro -> " Pro"; Tier.displayName overrides. */
export function deriveTierName(toolName: string, tier: Tier): string {
  if (tier.displayName) return tier.displayName;
  if (tier.level === "plus") return `${toolName}+`;
  if (tier.level === "pro") return `${toolName} Pro`;
  return toolName;
}

export type BundleWithCoverage = PrismaBundle & {
  tiers: (BundleTier & { tier: Tier & { feature: Feature & { surfaces: PrismaTool[] } } })[];
};

export interface BundleCoverage {
  /** Derived: true only if every Tool surface this bundle covers is active. */
  available: boolean;
  /** Per-covered-feature display lines, e.g. "REIscore — 50 analyses/mo". */
  coverageLines: string[];
  /** Feature slugs covered — the smart-cart match key, not for display. */
  coversFeatureSlugs: string[];
}

export function deriveBundleCoverage(bundle: BundleWithCoverage): BundleCoverage {
  const coveredTools = bundle.tiers.flatMap((bt) => bt.tier.feature.surfaces);
  const available = coveredTools.length > 0 && coveredTools.every((tool) => tool.active);

  const coverageLines = bundle.tiers.map((bt) => {
    const feature = bt.tier.feature;
    const label = feature.unifiedName ?? feature.surfaces[0]?.name ?? feature.slug;
    const unit = feature.surfaces[0]?.unit ?? "units";
    const allowanceText = bt.tier.allowance === null ? "Unlimited" : `${bt.tier.allowance}`;
    return `${label} — ${allowanceText} ${unit}/mo`;
  });

  const coversFeatureSlugs = Array.from(new Set(bundle.tiers.map((bt) => bt.tier.feature.slug)));

  return { available, coverageLines, coversFeatureSlugs };
}
