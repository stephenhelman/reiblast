import type { StoreBundle } from "@/types/store";

export type CartItemKind = "sub" | "once" | "credits";

/** One tool_sub line nested inside a bundle cart item — mirrors lib/bundlePricing.ts#BundleLine, priced. */
export interface CartLineItem {
  featureSlug: string;
  level: "base" | "plus" | "pro";
  /** The real Tier row id — 5a's live-cart write-through resolves CartLine.tierId from this. */
  tierId: string;
  /** Display name for the nested row, e.g. "REIscore Pro". */
  name: string;
  /** In-bundle price for this line. */
  priceCents: number;
  /** À-la-carte price for this line, for the struck-through receipt view. */
  alaCartePriceCents: number;
  stripePriceId: string | null;
}

export interface CartItem {
  id: string;
  kind: CartItemKind;
  name: string;
  priceCents: number;
  /** Stripe test-mode Price id for this row; null when the item has no checkout-eligible Price (e.g. op-direct services) OR when this item is a bundle group (its Price lives on `lines` instead). Checkout is blocked whenever any cart item/line lacks one. */
  stripePriceId: string | null;
  /** Present for solo tool subs — matched against a bundle's coversFeatureSlugs for the smart-cart suggestion, and against qualifyBundle for the nudge modal. */
  featureSlug?: string;
  level?: "base" | "plus" | "pro";
  /** Present when this item IS a bundle purchase, so it's never re-suggested. */
  bundleSlug?: string;
  /** Present only for a bundle purchase — the N priced tool_sub lines it fans out into (never a single Price). */
  lines?: CartLineItem[];
  /** kind 'sub' (solo, non-bundle) only — the real Tier row id, for 5a's live-cart write-through. Absent for bundle items (see `lines[].tierId` instead) and 'once' (op-direct — no Tier row exists). */
  tierId?: string;
  /** kind 'credits' only — the real CreditPack row id, for 5a's live-cart write-through. */
  creditPackId?: string;
}

export type LearnMoreSubject =
  | { kind: "tool"; toolSlug: string }
  | { kind: "bundle"; bundleSlug: string }
  | { kind: "service"; serviceId: string };

const LEVEL_SUFFIX: Record<"base" | "plus" | "pro", string> = { base: "", plus: "+", pro: " Pro" };

/**
 * The ONE path that turns a StoreBundle into a cart item — both the
 * Bundles-tab "Get the bundle" CTA (LearnMoreModal) and the smart-cart
 * nudge modal compose through this, so they can never drift into two
 * different ideas of what a bundle purchase is.
 */
export function composeBundleCartItem(bundle: StoreBundle, toolNames: Record<string, string>): CartItem {
  return {
    id: bundle.id,
    kind: "sub",
    name: `${bundle.name} bundle`,
    priceCents: bundle.priceCents,
    stripePriceId: null,
    bundleSlug: bundle.slug,
    lines: bundle.lines.map((line) => {
      const toolName = toolNames[line.featureSlug] ?? line.featureSlug;
      return {
        featureSlug: line.featureSlug,
        level: line.level,
        tierId: line.tierId,
        name: `${toolName}${LEVEL_SUFFIX[line.level]}`,
        priceCents: line.priceCents,
        alaCartePriceCents: line.priceCents,
        stripePriceId: line.stripePriceId,
      };
    }),
  };
}
