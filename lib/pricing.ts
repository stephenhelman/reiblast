// Pure pricing/entitlement functions. No I/O, no catalog reads — callers pass in
// the tool/member/bundle data (from lib/catalog.ts) they already have.
//
// These are DISPLAY derivations only — cardStatus/resolveAllowance/packToUnits
// compute what a card or price should show. None of this debits the wallet,
// decrements an allowance pool, or enforces entitlement; that's separate,
// unbuilt wallet-mechanics work.

import type { Bundle, CardStatus, EntitlementKey, Member, Pack, SoloPlan, Tool } from "@/types/catalog";

export interface CartItem {
  entitlementKey: EntitlementKey;
  price: number;
}

export interface ResolvedAllowance {
  source: "bundle" | "solo-plan" | null;
  allowance: number | null;
}

/** The key a tool's allowance/covers/solo-plan lookups use — its own slug, unless it shares a pooled entitlement (e.g. rei-acq/rei-dispo -> "bots"). */
function entitlementKeyFor(tool: Tool): EntitlementKey {
  return tool.entitlementGroup ?? tool.slug;
}

/**
 * Units a universal credit pack buys for a given tool: floor(pack.credits / tool.creditCost.amount).
 * Works for any metered tool from the same shared-wallet pack — there's no
 * per-tool pack to mismatch against, so this never throws. A tool that
 * doesn't consume credits (consumesCredits: false, or no creditCost) simply
 * yields 0 — credits don't apply to it.
 */
export function packToUnits(pack: Pack, tool: Tool): number {
  if (!tool.consumesCredits || !tool.creditCost) return 0;
  return Math.floor(pack.credits / tool.creditCost.amount);
}

/**
 * Highest covering plan wins — bundle and solo-plan allowances never stack.
 * If both the member's bundle and a solo plan cover the tool's entitlement,
 * the larger allowance is used, not their sum.
 */
export function resolveAllowance(
  tool: Tool,
  member: Member,
  bundle: Bundle | null,
  soloPlans: SoloPlan[],
): ResolvedAllowance {
  const key = entitlementKeyFor(tool);

  const bundleAllowance =
    bundle && bundle.covers.includes(key) ? bundle.allowances[key] ?? Infinity : null;

  // An entitlement can have more than one purchasable tier (e.g. REIscore Plus
  // vs Pro solo) — select the owned plan for this key with the highest
  // allowance, since owning one tier is what matters, not which was found first.
  const ownedSoloPlans = soloPlans.filter(
    (plan) => plan.entitlementKey === key && member.entitlements.soloPlanIds.includes(plan.id),
  );
  const soloAllowance =
    ownedSoloPlans.length > 0 ? Math.max(...ownedSoloPlans.map((plan) => plan.allowance)) : null;

  if (bundleAllowance === null && soloAllowance === null) {
    return { source: null, allowance: null };
  }

  if (bundleAllowance !== null && (soloAllowance === null || bundleAllowance >= soloAllowance)) {
    return { source: "bundle", allowance: bundleAllowance };
  }

  return { source: "solo-plan", allowance: soloAllowance };
}

/**
 * Resolves the launcher/store card status for a tool given a member and their
 * active bundle. Display only: "on-credits"/"out-of-credits" both read the
 * ONE shared wallet balance — they do not track or debit anything.
 */
export function cardStatus(
  tool: Tool,
  member: Member,
  bundle: Bundle | null,
  soloPlans: SoloPlan[],
): CardStatus {
  if (tool.comingSoon) return "coming-soon";
  if (tool.free) return "free";

  const { allowance } = resolveAllowance(tool, member, bundle, soloPlans);
  if (allowance !== null) return "in-plan";

  if (!tool.consumesCredits) return "locked";

  if (member.entitlements.creditBalance > 0) return "on-credits";
  if (member.entitlements.hasEverBoughtCredits) return "out-of-credits";

  return "locked";
}

/**
 * Cheapest bundle that covers every item in the cart and costs less than
 * buying those items individually. Returns null if no bundle qualifies.
 */
export function smartCart(cart: CartItem[], bundles: Bundle[]): Bundle | null {
  if (cart.length === 0) return null;

  const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);
  const cartKeys = cart.map((item) => item.entitlementKey);

  const qualifying = bundles.filter(
    (bundle) =>
      cartKeys.every((key) => bundle.covers.includes(key)) && bundle.price < cartTotal,
  );

  if (qualifying.length === 0) return null;

  return qualifying.reduce((cheapest, bundle) =>
    bundle.price < cheapest.price ? bundle : cheapest,
  );
}
