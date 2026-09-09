// Pure pricing/entitlement functions. No I/O, no catalog reads — callers pass in
// the tool/member/bundle data (from lib/catalog.ts) they already have.

import type { Bundle, CardStatus, Member, Pack, SoloPlan, Tool, ToolSlug } from "@/types/catalog";

export interface CartItem {
  toolSlug: ToolSlug;
  price: number;
}

export interface ResolvedAllowance {
  source: "bundle" | "solo-plan" | null;
  allowance: number | null;
}

/** Units a given pack grants for a given tool. Throws if the pack isn't for that tool. */
export function packToUnits(pack: Pack, tool: Tool): number {
  if (pack.toolSlug !== tool.slug) {
    throw new Error(`Pack ${pack.id} is not for tool ${tool.slug}`);
  }
  return pack.units;
}

/**
 * Highest covering plan wins — bundle and solo-plan allowances never stack.
 * If both the member's bundle and a solo plan cover the tool, the larger
 * allowance is used, not their sum.
 */
export function resolveAllowance(
  tool: Tool,
  member: Member,
  bundle: Bundle | null,
  soloPlans: SoloPlan[],
): ResolvedAllowance {
  const bundleAllowance =
    bundle && bundle.covers.includes(tool.slug) ? bundle.allowances[tool.slug] ?? Infinity : null;

  const hasSoloPlan = member.entitlements.soloPlanToolSlugs.includes(tool.slug);
  const soloPlan = hasSoloPlan ? soloPlans.find((plan) => plan.toolSlug === tool.slug) : undefined;
  const soloAllowance = soloPlan ? soloPlan.allowance : null;

  if (bundleAllowance === null && soloAllowance === null) {
    return { source: null, allowance: null };
  }

  if (bundleAllowance !== null && (soloAllowance === null || bundleAllowance >= soloAllowance)) {
    return { source: "bundle", allowance: bundleAllowance };
  }

  return { source: "solo-plan", allowance: soloAllowance };
}

/** Resolves the launcher card status for a tool given a member and their active bundle. */
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

  const creditBalance = member.entitlements.creditBalances[tool.slug] ?? 0;
  if (creditBalance > 0) return "on-credits";

  if (member.entitlements.toolsWithCreditHistory.includes(tool.slug)) return "out-of-credits";

  return "locked";
}

/**
 * Cheapest bundle that covers every item in the cart and costs less than
 * buying those items individually. Returns null if no bundle qualifies.
 */
export function smartCart(cart: CartItem[], bundles: Bundle[]): Bundle | null {
  if (cart.length === 0) return null;

  const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);
  const cartSlugs = cart.map((item) => item.toolSlug);

  const qualifying = bundles.filter(
    (bundle) =>
      cartSlugs.every((slug) => bundle.covers.includes(slug)) && bundle.price < cartTotal,
  );

  if (qualifying.length === 0) return null;

  return qualifying.reduce((cheapest, bundle) =>
    bundle.price < cheapest.price ? bundle : cheapest,
  );
}
