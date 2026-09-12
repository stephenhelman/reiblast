// Discovery-only view-model — catalog-render, roadmap-everything, NO member.
// There is no session pre-a2p, so there is no entitlement axis at all: every
// product is either active (normal learn-more card) or coming-soon. Discovery
// is all LABEL, no blur — roadmap sells by labeling it clearly, not obscuring
// it (that's a launcher treatment). No "locked" state exists here — locked is
// what a LOGGED-IN member without a subscription sees (store); discovery has
// no logged-in member to be locked out as.

import type { ToolSlug } from "@/types/catalog";
import type { StoreAddonService } from "@/types/store";

export type DiscoveryStatus = "active" | "coming-soon";

export interface DiscoveryTool {
  id: string;
  slug: string;
  brandSlug: ToolSlug;
  name: string;
  tagline: string;
  hook: string;
  compareCopy: string[];
  unit: string;
  featureSlug: string;
  status: DiscoveryStatus;
  /** Feature.bucket — decides whether the base tier is membership-included (Score/Scrub) or a paid floor (Pack/Ask/bots). */
  bucket: "core_included" | "addon";
  /** The base Tier's priceCents — the FLOOR only. Discovery never shows plus/pro prices (anchoring risk). */
  basePriceCents: number;
  /** lib/entitlement.ts#hasHigherTier evaluated at the base level (no member here, so "current level" is always base) — gates the "More options available" line. */
  hasHigherTier: boolean;
}

/** One rung of the REItools bundling ladder (Plus or Pro) — informational only, no price, no per-tool tier breakdown. */
export interface DiscoveryBundlingTier {
  level: "plus" | "pro";
  name: string;
  includedToolNames: string[];
}

/**
 * REItools is ONE product with a tier ladder (base = included in REIblast;
 * Plus/Pro = the two paid bundle tiers) — rendered as ONE card, never two.
 * `status` is a single umbrella state: "active" only once EVERY tool either
 * paid tier covers is live (so both tiers can be shown as real, working
 * options together); otherwise "coming-soon" for the whole ladder.
 */
export interface DiscoveryBundling {
  status: DiscoveryStatus;
  tiers: DiscoveryBundlingTier[];
}

export interface DiscoveryCatalog {
  tools: DiscoveryTool[];
  bundling: DiscoveryBundling;
  /** Op-direct services (REIsite/REIkit) — config-only, reused verbatim from the store's type. */
  addons: StoreAddonService[];
}

/** A single line on the call-agenda checklist. */
export interface DiscoveryListItem {
  /** Unique per-item key (kind-prefixed) for React lists and removal. */
  id: string;
  kind: "tool" | "bundling" | "service";
  name: string;
  /** The underlying DB slug for a tool/service. Bundling interest is tier-agnostic — "bundling" is a synthetic slug, never a specific bundle-plus/bundle-pro row. */
  slug: string;
}
