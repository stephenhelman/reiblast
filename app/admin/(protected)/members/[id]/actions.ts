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

async function requireAdminUserId(): Promise<string | { error: string }> {
  try {
    const admin = await requireAdmin(prisma)
    return admin.userId
  } catch (err) {
    if (err instanceof RequireAdminError) return { error: 'Not authorized.' }
    throw err
  }
}

export type StageSubscriptionAddResult = { ok: true } | { error: string }

export async function stageSubscriptionAddAction(
  memberUserId: string,
  featureId: string,
  tierId: string,
): Promise<StageSubscriptionAddResult> {
  const adminUserId = await requireAdminUserId()
  if (typeof adminUserId !== 'string') return adminUserId

  try {
    await prisma.$transaction((tx) => stageSubscriptionAddCore(tx, { adminUserId, memberUserId, featureId, tierId }))
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not stage this subscription.' }
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
