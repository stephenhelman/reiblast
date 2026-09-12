export type CartItemKind = "sub" | "once" | "credits";

export interface CartItem {
  id: string;
  kind: CartItemKind;
  name: string;
  priceCents: number;
  /** Present for solo tool subs — matched against a bundle's coversFeatureSlugs for the smart-cart suggestion. Universal credit packs and bundle purchases have none. */
  featureSlug?: string;
  /** Present when this item IS a bundle purchase, so it's never re-suggested. */
  bundleSlug?: string;
}

export type LearnMoreSubject =
  | { kind: "tool"; toolSlug: string }
  | { kind: "bundle"; bundleSlug: string }
  | { kind: "service"; serviceId: string };
