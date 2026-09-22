'use server'

// The admin dossier's write path (Phase 3.5 — the change PRODUCER). Every
// action here writes a PROPOSAL, never an entitlement execution — see
// lib/engine/adminProposals.ts. Admin-gated: requireAdmin fails closed on
// anything but role 'admin' (the member surface's resolveSessionUserId is
// NOT sufficient here — this is an admin-only write).

import { prisma } from '@/lib/prisma'
import { requireAdmin, RequireAdminError } from '@/lib/requireAdmin'
import {
  stageSubscriptionAddCore,
  proposeSubscriptionChangeCore,
  type ProposeChangeParams,
} from '@/lib/engine/adminProposals'
import { overrideMemberCartCore } from '@/lib/engine/memberCart'

async function requireAdminUserId(): Promise<string | { error: string }> {
  try {
    const admin = await requireAdmin(prisma)
    return admin.userId
  } catch (err) {
    if (err instanceof RequireAdminError) return { error: 'Not authorized.' }
    throw err
  }
}

export type StageSubscriptionAddResult =
  | { ok: true }
  // Direction 2 (5a) — an open member_self cart is in the way. Nothing was
  // written. The dossier surfaces this as a confirm prompt; a second call to
  // overrideMemberCartAction (below), only after the admin explicitly
  // confirms, performs the actual override.
  | { requiresOverrideConfirm: true; memberCartId: string }
  | { error: string }

export async function stageSubscriptionAddAction(
  memberUserId: string,
  featureId: string,
  tierId: string,
): Promise<StageSubscriptionAddResult> {
  const adminUserId = await requireAdminUserId()
  if (typeof adminUserId !== 'string') return adminUserId

  try {
    const result = await prisma.$transaction((tx) => stageSubscriptionAddCore(tx, { adminUserId, memberUserId, featureId, tierId }))
    if ('requiresOverrideConfirm' in result) return result
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not stage this subscription.' }
  }
}

export type OverrideMemberCartResult = { ok: true } | { error: string }

// The CONFIRMED half of Direction 2 — only reached after the admin has seen
// the requiresOverrideConfirm prompt and explicitly confirmed the member's
// verbal agreement (on a call) to replace their in-progress cart. Runs
// overrideMemberCartCore in its own tx: expire the member_self cart, stage
// the admin_staged replacement, write the cart_override AdminAction — one
// atomic unit, same as every other admin-write core here.
export async function overrideMemberCartAction(memberUserId: string, tierId: string): Promise<OverrideMemberCartResult> {
  const adminUserId = await requireAdminUserId()
  if (typeof adminUserId !== 'string') return adminUserId

  try {
    await prisma.$transaction((tx) =>
      overrideMemberCartCore(tx, { adminUserId, memberUserId, mode: 'subscription', proposalTierIds: [tierId] }),
    )
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not override this cart.' }
  }
}

export type ProposeSubscriptionChangeResult = { ok: true } | { error: string }

export async function proposeSubscriptionChangeAction(
  memberUserId: string,
  featureId: string,
  changeType: 'cancel' | 'tier_change',
  newTierId?: string,
): Promise<ProposeSubscriptionChangeResult> {
  const adminUserId = await requireAdminUserId()
  if (typeof adminUserId !== 'string') return adminUserId

  const params: ProposeChangeParams =
    changeType === 'cancel'
      ? { adminUserId, memberUserId, featureId, changeType: 'cancel' }
      : { adminUserId, memberUserId, featureId, changeType: 'tier_change', newTierId: newTierId ?? '' }

  if (changeType === 'tier_change' && !newTierId) {
    return { error: 'A target tier is required.' }
  }

  try {
    await prisma.$transaction((tx) => proposeSubscriptionChangeCore(tx, params))
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not propose this change.' }
  }
}
