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

export type BundleSlug = "core" | "plus" | "pro";

export type CardStatus =
  | "in-plan"
  | "on-credits"
  | "out-of-credits"
  | "locked"
  | "free"
  | "coming-soon";

export interface Tool {
  type: "tool";
  slug: ToolSlug;
  name: string;
  tagline: string;
  hook: string;
  icon: string;
  wordmark: string;
  category: string;
  /** Unit consumed per use, e.g. "run", "lookup", "send". */
  unit: string;
  /** Launcher "Open" target. Placeholder route until each tool has a real page. */
  href: string;
  /** Always shows as "free" regardless of plan/credits. */
  free?: boolean;
  comingSoon?: boolean;
  compareCopy: string[];
}

export interface Pack {
  type: "pack";
  id: string;
  toolSlug: ToolSlug;
  name: string;
  units: number;
  price: number;
}

export interface Bundle {
  type: "bundle";
  id: string;
  slug: BundleSlug;
  name: string;
  tagline: string;
  /** Additive OP-only price on top of the 57 core membership. Core bundle is baseline at 0 (+$0). */
  price: number;
  covers: ToolSlug[];
  /** Monthly credit allowance per covered tool. Absent tool = unlimited/flat access if covered. */
  allowances: Partial<Record<ToolSlug, number>>;
  compareCopy: string[];
}

export interface SoloPlan {
  type: "solo-plan";
  id: string;
  toolSlug: ToolSlug;
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
  price: number;
  compareCopy: string[];
}

export type CatalogItem = Tool | Pack | Bundle | SoloPlan | OpDirectService;

export interface Catalog {
  tools: Tool[];
  packs: Pack[];
  bundles: Bundle[];
  soloPlans: SoloPlan[];
  opDirectServices: OpDirectService[];
}

export interface MemberEntitlements {
  bundleSlug: BundleSlug | null;
  soloPlanToolSlugs: ToolSlug[];
  /** Remaining credit balance per tool, from purchased packs. */
  creditBalances: Partial<Record<ToolSlug, number>>;
  /** Tools the member has purchased credits for at some point (distinguishes never-touched "locked" from "out-of-credits"). */
  toolsWithCreditHistory: ToolSlug[];
  /** Units consumed so far in the current allowance period, for tools covered by a bundle/solo-plan allowance. */
  allowanceUsed: Partial<Record<ToolSlug, number>>;
  opDirectServiceIds: string[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
  entitlements: MemberEntitlements;
}
