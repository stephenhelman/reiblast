'use server'

import { prisma } from '@/lib/prisma'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { mintCheckout } from '@/lib/checkout'

export type StartCheckoutResult = { clientSecret: string } | { error: string }

// The "caller" mintCheckout's contract expects: resolves the authenticated
// member from the existing /enter session (same path the store surface
// already reads via getStoreData/resolveSessionUserId), then hands that
// userId to the auth-agnostic mintCheckout primitive.
export async function startCheckoutAction(priceIds: string[]): Promise<StartCheckoutResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    return await mintCheckout(userId, priceIds)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Checkout failed.' }
  }
}
