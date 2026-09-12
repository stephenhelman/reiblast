// Pure cart-display logic for the store. No I/O. Parallel to the old
// lib/pricing.ts#smartCart (still used by nothing now that the store reads
// the DB view-model) but keyed on featureSlug/priceCents instead of
// EntitlementKey/dollars, and excludes bundles that are coming-soon —
// never suggest swapping into something unpurchasable.

import type { StoreBundle } from "@/types/store";

export interface CartLine {
  featureSlug: string;
  priceCents: number;
}

/**
 * Cheapest AVAILABLE bundle that covers every feature in the cart and costs
 * less than buying those items individually. Returns null if none qualifies.
 */
export function smartCartSuggestion(cart: CartLine[], bundles: StoreBundle[]): StoreBundle | null {
  if (cart.length === 0) return null;

  const cartTotalCents = cart.reduce((sum, item) => sum + item.priceCents, 0);
  const cartFeatureSlugs = cart.map((item) => item.featureSlug);

  const qualifying = bundles.filter(
    (bundle) =>
      bundle.available &&
      cartFeatureSlugs.every((slug) => bundle.coversFeatureSlugs.includes(slug)) &&
      bundle.priceCents < cartTotalCents,
  );

  if (qualifying.length === 0) return null;

  return qualifying.reduce((cheapest, bundle) => (bundle.priceCents < cheapest.priceCents ? bundle : cheapest));
}
