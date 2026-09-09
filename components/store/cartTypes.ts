import type { BundleSlug, EntitlementKey, ToolSlug } from '@/types/catalog'

export type CartItemKind = 'sub' | 'once' | 'credits'

export interface CartItem {
  id: string
  kind: CartItemKind
  name: string
  price: number
  /** Present for solo-plan subs — used to match against a bundle's `covers` for the smart-cart suggestion. Universal credit packs have none. */
  entitlementKey?: EntitlementKey
  /** Present when this item IS a bundle purchase, so it's never re-suggested. */
  bundleSlug?: BundleSlug
}

export type LearnMoreSubject =
  | { kind: 'tool'; toolSlug: ToolSlug }
  | { kind: 'bundle'; bundleSlug: BundleSlug }
  | { kind: 'service'; serviceId: string }
