// Pure smart-cart nudge derivation. No I/O — reads only what's already on
// screen (the cart) and the fetched catalog (bundles/packs). Qualification
// itself is never reimplemented here: this only enumerates which single
// missing line would flip lib/bundleQualify.ts#qualifyBundle's answer, using
// StoreBundle.coversFeatureSlugs/lines the same way lib/storeCart.ts does.

import type { StoreBundle, StorePack } from "@/types/store";
import { STORE_BUNDLE_FREE_PACK_COUNT, STORE_PACK_BEST_VALUE_SLUG } from "@/config/storeCopy";
import type { CartItem } from "./cartTypes";

export type NudgeType = "A" | "B";

export interface BundleNudge {
  type: NudgeType;
  bundle: StoreBundle;
  /** Actual bill change from applying this nudge (rises or holds — never a "your bill goes down"). */
  billDeltaCents: number;
  /** Sum of the bundle's lines at à-la-carte price, minus the bundle price — the "vs à-la-carte" sell number. */
  valueVsAlaCarteCents: number;
  freePackCount: number;
  perkValueCents: number;
  /** bill_delta < perk_value — the free-pack perk alone outweighs what the member pays to get there. */
  punchy: boolean;
}

const LEVEL_RANK: Record<"base" | "plus" | "pro", number> = { base: 0, plus: 1, pro: 2 };

function soloCartItems(cart: CartItem[]): (CartItem & { featureSlug: string })[] {
  return cart.filter((i): i is CartItem & { featureSlug: string } => !!i.featureSlug && !i.bundleSlug);
}

/**
 * How many of the bundle's lines the cart does NOT already satisfy — tier-
 * floored like lib/bundleQualify.ts#qualifyBundle's own atLeast check, not
 * just featureSlug presence (a solo score/base line does NOT satisfy a
 * bundle line that needs score/plus).
 */
function missingLineCount(bundle: StoreBundle, solo: (CartItem & { featureSlug: string })[]): number {
  return bundle.lines.filter((line) => {
    const match = solo.find((i) => i.featureSlug === line.featureSlug);
    if (!match?.level) return true;
    return LEVEL_RANK[match.level] < LEVEL_RANK[line.level];
  }).length;
}

function perkFor(bundle: StoreBundle, packs: StorePack[]): { freePackCount: number; perkValueCents: number } {
  const freePackCount = STORE_BUNDLE_FREE_PACK_COUNT[bundle.slug] ?? 0;
  const perkPack = packs.find((p) => p.slug === STORE_PACK_BEST_VALUE_SLUG) ?? packs[0];
  const perkValueCents = perkPack ? freePackCount * perkPack.priceCents : 0;
  return { freePackCount, perkValueCents };
}

function billDeltaFor(bundle: StoreBundle, solo: (CartItem & { featureSlug: string })[]): number {
  const coveredCents = solo
    .filter((i) => bundle.coversFeatureSlugs.includes(i.featureSlug))
    .reduce((sum, i) => sum + i.priceCents, 0);
  return bundle.priceCents - coveredCents;
}

function valueVsAlaCarteFor(bundle: StoreBundle): number {
  const alaCarteTotal = bundle.lines.reduce((sum, l) => sum + l.priceCents, 0);
  return alaCarteTotal - bundle.priceCents;
}

/**
 * Silent (null) when the cart already sits on the best available bundle, or
 * when every available bundle is more than one missing line away. Otherwise
 * the cheapest one-move-away bundle the cart isn't already carrying.
 */
export function computeBundleNudge(cart: CartItem[], bundles: StoreBundle[], packs: StorePack[]): BundleNudge | null {
  const alreadyHasBundle = cart.some((i) => !!i.bundleSlug);
  if (alreadyHasBundle) return null; // a bundle line item is already in the cart — nothing further to nudge

  const solo = soloCartItems(cart);
  if (solo.length === 0) return null;

  const candidates = bundles
    .filter((b) => b.available)
    .map((b) => ({ bundle: b, missing: missingLineCount(b, solo) }))
    .filter((c) => c.missing === 1)
    .sort((a, b) => a.bundle.priceCents - b.bundle.priceCents);

  const chosen = candidates[0];
  if (!chosen) return null;

  const coveredByLowerBundle = bundles.some(
    (b) => b.available && b.priceCents < chosen.bundle.priceCents && missingLineCount(b, solo) === 0,
  );
  const type: NudgeType = coveredByLowerBundle ? "B" : "A";

  const { freePackCount, perkValueCents } = perkFor(chosen.bundle, packs);
  const billDeltaCents = billDeltaFor(chosen.bundle, solo);
  const valueVsAlaCarteCents = valueVsAlaCarteFor(chosen.bundle);

  return {
    type,
    bundle: chosen.bundle,
    billDeltaCents,
    valueVsAlaCarteCents,
    freePackCount,
    perkValueCents,
    punchy: billDeltaCents < perkValueCents,
  };
}
