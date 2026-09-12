// Store-only view-model types — parallel to types/launcher.ts, reading the
// same engine tables through the same 2-axis rule, but shaped for the store's
// four tabs (tiers for the learn-more modal, bundle coverage/availability,
// pack translation) instead of the launcher's card sub-states.

import type { ToolSlug } from "@/types/catalog";

/** Tools-tab pill: coming-soon (Axis 1) / available (Axis 2, not entitled) / in-plan (Axis 2, entitled). No price-per-use, so no meter/credits sub-states here. */
export type StoreToolStatus = "coming-soon" | "available" | "in-plan";

export interface StoreTier {
  id: string;
  level: "base" | "plus" | "pro";
  /** Derived (feature/tool name + level suffix) or Tier.displayName override — see sprint doc §5. */
  name: string;
  priceCents: number;
  /** null = unlimited. */
  allowance: number | null;
}

export interface StoreTool {
  id: string;
  /** Bare DB slug (score/scrub/pack/ask/acq/dispo). */
  slug: string;
  brandSlug: ToolSlug;
  name: string;
  tagline: string;
  hook: string;
  compareCopy: string[];
  /** Tool.unit, display-ready plural — never pluralized at render time. */
  unit: string;
  active: boolean;
  featureSlug: string;
  creditCost: number;
  unitsPerDebit: number;
  meteringShape: "per_cycle" | "by_volume" | "none";
  status: StoreToolStatus;
  /** This feature's Tier rows, for the learn-more modal. Empty when coming-soon (not fetched). */
  tiers: StoreTier[];
  /** Whether a Tier above the member's currently resolved level exists — the "upgrade" honesty check (lib/entitlement.ts#hasHigherTier). False while coming-soon. */
  hasHigherTier: boolean;
}

export interface StorePack {
  id: string;
  slug: string;
  credits: number;
  priceCents: number;
  /** Presentation-only flag, no DB column — see config/storeCopy.ts. */
  bestValue?: boolean;
}

export interface StoreBundle {
  id: string;
  slug: string;
  name: string;
  level: "plus" | "pro";
  priceCents: number;
  /** Static selling copy — see config/storeCopy.ts deferral note. */
  tagline: string;
  bestValue?: boolean;
  /** Derived: true only if every Tool surface this bundle covers is active. */
  available: boolean;
  /** Derived per-covered-feature lines ("REIscore — 50 analyses/mo"), built from real Tier/Tool data. */
  coverageLines: string[];
  /** Feature slugs this bundle covers — the smart-cart match key, not for display. */
  coversFeatureSlugs: string[];
}

export interface StoreCoreBaseline {
  name: string;
  tagline: string;
  /** Derived from core_included features' base tiers + active surfaces. */
  coverageLines: string[];
}

export interface StoreAddonService {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  hook: string;
  compareCopy: string[];
  priceCents: number;
  /** Op-direct services are config-only (never a DB Tool row) but share brand art with their in-app tool namesake. */
  toolSlug?: ToolSlug;
}

export interface StoreMember {
  name: string;
  walletBalance: number;
  currentBundleSlug: string | null;
}

export interface StoreData {
  member: StoreMember;
  tools: StoreTool[];
  packs: StorePack[];
  bundles: StoreBundle[];
  coreBaseline: StoreCoreBaseline;
  addons: StoreAddonService[];
  membership: { name: string; priceCents: number };
}
