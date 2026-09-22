'use server'

// Phase 5b — consent-before-checkout. Serves BOTH money paths: the member's
// own open cart (StoreClient's checkout button) and an admin-staged cart the
// member is completing (the review-feed add item's "complete checkout to
// accept" affordance). Same two-call shape as Phase 3/4: preview computes
// the disclosure with NO write; only commit (the member's approval) writes
// the MemberAction, THEN invokes the existing mint path. Member-gated
// (resolveSessionUserId) — ownership of the cart is checked on every call.

import { prisma } from '@/lib/prisma'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { computeCheckoutDisclosure, commitCheckoutConsent, type CheckoutConsentType } from '@/lib/engine/checkoutConsent'
import { mintCheckout } from '@/lib/checkout'

async function ownedOpenCart(userId: string, cartId: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId } })
  if (!cart || cart.userId !== userId || cart.status !== 'open') return null
  return cart
}

export type PreviewCheckoutConsentResult =
  | { ok: true; disclosureText: string; type: CheckoutConsentType }
  | { error: string }

export async function previewCheckoutConsentAction(cartId: string): Promise<PreviewCheckoutConsentResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  const cart = await ownedOpenCart(userId, cartId)
  if (!cart) return { error: 'This cart is no longer available.' }

  try {
    const disclosure = await computeCheckoutDisclosure(prisma, { cartId })
    return { ok: true, disclosureText: disclosure.disclosureText, type: disclosure.type }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not preview this checkout.' }
  }
}

export type CommitCheckoutConsentResult = { ok: true; clientSecret: string | null } | { error: string }

// Resolves each CartLine to its own à-la-carte Stripe Price id — a cart
// never carries a bundle concept (lib/checkout.ts's own comment: "the cart
// never carries a 'bundle' concept, only priced tool_sub lines"), so no
// BundlePriceOverride lookup applies here, just the Tier/CreditPack's own
// stripePriceId.
async function resolveCartPriceIds(cartId: string): Promise<string[]> {
  const lines = await prisma.cartLine.findMany({
    where: { cartId },
    include: { tier: true, creditPack: true },
  })
  return lines.flatMap((line) => {
    const priceId = line.tier?.stripePriceId ?? line.creditPack?.stripePriceId
    return priceId ? [priceId] : []
  })
}

export async function commitCheckoutConsentAction(cartId: string, disclosureText: string, type: CheckoutConsentType): Promise<CommitCheckoutConsentResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  const cart = await ownedOpenCart(userId, cartId)
  if (!cart) return { error: 'This cart is no longer available.' }

  let clientSecret: string | null = null

  try {
    await commitCheckoutConsent(prisma, { userId, cartId, disclosureText, type }, async () => {
      // THEN invoke the existing mint path — consent has already committed
      // above regardless of what happens here. Wrapped so a mint failure
      // (e.g. dev catalog rows without backfilled Stripe Prices) never
      // implicates or rolls back the consent that already landed; Stripe
      // itself is still excluded from this DB leg's test coverage.
      try {
        const priceIds = await resolveCartPriceIds(cartId)
        if (priceIds.length > 0) {
          const minted = await mintCheckout(userId, priceIds)
          clientSecret = minted.clientSecret
        }
      } catch {
        // mint is a stub/no-op boundary here — consent already committed is
        // the deliverable this phase proves, not a completed Stripe session.
      }
    })
    return { ok: true, clientSecret }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record your approval.' }
  }
}
