// Launcher-only view-model types — the 2-axis card model (active x entitlement).
// Deliberately separate from types/catalog.ts, which the store surface still
// owns and reads (config/catalog.ts const seed, fractional creditCost.amount,
// comingSoon/free booleans). The launcher now reads Prisma directly; this file
// is the shape lib/launcherCatalog.ts produces and components/tools/* consumes.

import type { ToolSlug } from "@/types/catalog";

/** Axis 1 (active) terminates at coming-soon; axis 2 (entitlement) splits locked vs accessible. */
export type LauncherCardStatus = "coming-soon" | "locked" | "accessible";

/** Sub-state within "accessible", derived from resolver allowance/balance. */
export type AccessibleState = "meter" | "unlimited" | "credits" | "out-of-credits";

export interface LauncherTool {
  id: string;
  /** Bare DB slug (score/scrub/pack/ask/acq/dispo) — never used to key brand assets directly. */
  slug: string;
  /** rei-* slug for lib/brandAssets.ts — the one place the dbSlug->brandSlug mapping happens. */
  brandSlug: ToolSlug;
  name: string;
  tagline: string;
  unit: string;
  href: string;
  active: boolean;
  cardStatus: LauncherCardStatus;
  /** Set only when cardStatus === "accessible". */
  accessibleState?: AccessibleState;
  /** Resolver output — present whenever active (locked cards still show allowance context is irrelevant, so null while coming-soon). */
  allowance: number | null;
  used: number;
  remaining: number | null;
  /** DB two-field credit cost shape — replaces the old fractional creditCost.amount. */
  creditCost: number;
  unitsPerDebit: number;
  /** Whether this feature has a Tier above the member's current resolved level — the "upgrade" honesty check (lib/entitlement.ts#hasHigherTier). False while coming-soon. */
  hasHigherTier: boolean;
  /**
   * Feature slug this tool bills against — "bots" for acq/dispo (shared pool).
   * TODO(bots collapse): when both acq and dispo are active, they should collapse
   * into one REIclose card keyed off Feature.unifiedName. Deferred — untestable
   * at launch with both surfaces inactive. Render both as independent cards until
   * that ships; this field is what the collapse logic will group on.
   */
  featureSlug: string;
}

export interface LauncherMember {
  id: string;
  name: string;
  email: string;
  /** Wallet.balance — credits, the one shared account-level balance. Not per-tool. */
  walletBalance: number;
  /** Drives the shared Tools|Store|Admin top nav (components/shared/TopNav.tsx) — Admin only renders for 'admin'. */
  role: "user" | "admin" | "manager" | "team_lead";
}

export interface LauncherData {
  member: LauncherMember;
  tools: LauncherTool[];
}
