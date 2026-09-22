'use server'

// 5a — the member's own live cart, write-through (Direction 1). Every call
// is member-gated (resolveSessionUserId) and check-then-writes in ONE tx via
// upsertMemberCartCore: if an admin_staged cart already occupies this
// (userId, mode) slot, nothing is written and the caller routes the member
// to the proposal instead.

import { prisma } from '@/lib/prisma'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { upsertMemberCartCore, declineStagedCartCore, type CartLineRef } from '@/lib/engine/memberCart'
import type { CartMode } from '@prisma/client'

export type SyncMemberCartResult =
  | { ok: true; cartId: string | null }
  | { blocked: 'admin_proposal_pending'; cartId: string }
  | { error: string }

export async function syncMemberCartAction(mode: CartMode, lines: CartLineRef[]): Promise<SyncMemberCartResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    return await prisma.$transaction((tx) => upsertMemberCartCore(tx, { userId, mode, lines }))
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update your cart.' }
  }
}

export type DeclineStagedCartResult = { ok: true } | { error: string }

// The member declining an admin's staged proposal — frees the (userId,mode)
// slot so the member's own cart can be written again.
export async function declineStagedCartAction(cartId: string): Promise<DeclineStagedCartResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    await prisma.$transaction((tx) => declineStagedCartCore(tx, { userId, cartId }))
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not decline this proposal.' }
  }
}
