// Catalog + member entitlement types for the tools portal launcher.
// No runtime logic here — see lib/catalog.ts (accessor) and lib/pricing.ts (pure functions).

export type ToolSlug =
  | "rei-score"
  | "rei-pack"
  | "rei-ask"
  | "rei-scrub"
  | "rei-dispo"
  | "rei-acq"
  | "rei-close"
  | "rei-site"
  | "rei-kit";

/**
 * Key used for allowances/covers/solo-plans/credit-usage lookups. Usually a
 * ToolSlug, but rei-acq and rei-dispo are two separate Tool marks that share
 * ONE entitlement — "bots" — one subscription, one allowance pool. A Tool
 * with `entitlementGroup` set uses that key instead of its own slug.
 */
export type EntitlementKey = ToolSlug | "bots";

export type BundleSlug = "core" | "plus" | "pro";

export type CardStatus =
  | "in-plan"
  | "on-credits"
  | "out-of-credits"
  | "locked"
  | "free"
  | "coming-soon";

/** Credits consumed per single use of the tool. Can be fractional (e.g. 0.2 = 5 uses per credit). */
export interface CreditCost {
  amount: number;
}

export interface Tool {
  type: "tool";
  slug: ToolSlug;
  name: string;
  tagline: string;
  hook: string;
  icon: string;
  wordmark: string;
  category: string;
  /** Unit consumed per use, e.g. "analysis", "packet", "query", "handoff". */
  unit: string;
  /** Launcher "Open" target. Placeholder route until each tool has a real page. */
  href: string;
  /** Whether this tool can be paid for out of the shared credit wallet at all. */
  consumesCredits: boolean;
  /** Required when consumesCredits is true. */
  creditCost?: CreditCost;
  /** Tools sharing one entitlement pool (rei-acq + rei-dispo -> "bots") set this instead of relying on their own slug. */
  entitlementGroup?: EntitlementKey;
  /** Always shows as "free" regardless of plan/credits. */
  free?: boolean;
  comingSoon?: boolean;
  compareCopy: string[];
}

/** A universal credit pack — just an amount of shared-wallet credits + a price. Not tied to any one tool. */
export interface Pack {
  type: "pack";
  id: string;
  name: string;
  credits: number;
  price: number;
  bestValue?: boolean;
}

export interface Bundle {
  type: "bundle";
  id: string;
  slug: BundleSlug;
  name: string;
  tagline: string;
  /** Additive OP-only price on top of the 57 core membership. Core bundle is baseline at 0 (+$0). */
  price: number;
  covers: EntitlementKey[];
  /** Monthly allowance per covered entitlement. Absent entry = unlimited/flat access if covered. */
  allowances: Partial<Record<EntitlementKey, number>>;
  compareCopy: string[];
  /** Store "Best value" flag. At most one bundle should carry this. */
  bestValue?: boolean;
}

export interface SoloPlan {
  type: "solo-plan";
  id: string;
  entitlementKey: EntitlementKey;
  name: string;
  price: number;
  allowance: number;
}

export interface OpDirectService {
  type: "op-direct";
  id: string;
  slug: string;
  name: string;
  tagline: string;
  hook: string;
  /** One-time price. Op-direct services are done-for-you builds, not subscriptions. */
  price: number;
  compareCopy: string[];
  /** Matching Tool, if any — lets the store reuse that tool's wordmark/icon brand assets. */
  toolSlug?: ToolSlug;
}

export type CatalogItem = Tool | Pack | Bundle | SoloPlan | OpDirectService;

export interface Catalog {
  tools: Tool[];
  packs: Pack[];
  /** Purchasable bundles only — Plus/Pro. Core is NOT a bundle row; see coreBaseline. */
  bundles: Bundle[];
  /**
   * Core is a non-purchasable reference baseline, not a store "bundle" — it's
   * what every member already has via the base membership. Shaped like a
   * Bundle (covers/allowances) so resolveAllowance/cardStatus can use it the
   * same way, but excluded from the purchasable bundles list.
   */
  coreBaseline: Bundle;
  soloPlans: SoloPlan[];
  opDirectServices: OpDirectService[];
  /** The base REIblast membership every store price sits on top of. Never folded into a bundle/pack price. */
  membership: { name: string; price: number };
}

export interface MemberEntitlements {
  bundleSlug: BundleSlug | null;
  /** Specific SoloPlan ids purchased — not just entitlement keys, since one entitlement (e.g. rei-score) can have multiple purchasable tiers. */
  soloPlanIds: string[];
  /** ONE shared credit wallet balance — not per-tool. */
  creditBalance: number;
  /** Whether the member has ever bought a credit pack (distinguishes never-touched "locked" from a drained "out-of-credits" wallet). */
  hasEverBoughtCredits: boolean;
  /** Units consumed so far in the current allowance period, per entitlement key. */
  allowanceUsed: Partial<Record<EntitlementKey, number>>;
  opDirectServiceIds: string[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
  entitlements: MemberEntitlements;
}
