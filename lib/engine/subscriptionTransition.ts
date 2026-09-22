import { Prisma } from '@prisma/client'
import { landSubscriptionItem, cancelOrphanSubscriptions } from './subscriptionLand'

type TxClient = Prisma.TransactionClient

export type TransitionType = 'upgrade' | 'downgrade' | 'cancel'

// Entitlement-ONLY core — extracted out of Phase 3's breakSubscriptionCore so
// the entitlement write and the consent write are no longer welded together
// (each caller now writes its own single MemberAction; see
// lib/engine/subscriptionBreak.ts#breakSubscriptionCore and
// lib/engine/finalizeProposal.ts#finalizeProposedChangeCore). Writes NO
// MemberAction. tx non-optional — same rule as every other engine core here:
// the entitlement change must commit atomically with whatever the caller
// pairs it with.
//
// Handles all three directions uniformly. At the entitlement level, upgrade
// and downgrade are MECHANICALLY IDENTICAL — cancel the old tier row, land
// the new one; direction is just which tier, the core doesn't care. Cancel is
// the status transition with no survivor tier. This is a pure relocation of
// breakSubscriptionCore's entitlement logic — the Subscription-row behavior
// is byte-for-byte unchanged, only where it lives moved.
export async function applySubscriptionTransition(
  tx: TxClient,
  params: {
    userId: string
    featureId: string
    changeType: TransitionType
    newTierId?: string
  },
): Promise<{ subscriptionId: string }> {
  const currentRow = await tx.subscription.findFirst({
    where: { userId: params.userId, featureId: params.featureId, status: 'active' },
  })
  if (!currentRow) {
    throw new Error(`applySubscriptionTransition: no active subscription for user ${params.userId} on feature ${params.featureId}`)
  }

  if (params.changeType === 'cancel') {
    // No survivor tier on this feature slot. Reuse the shared cancel-orphan
    // helper (never reimplemented) with a sentinel excludeTierId that can
    // never match a real Tier row, so every active row on this
    // (userId, featureId) slot — exactly one, per replace-not-stack — is
    // canceled and nothing is landed.
    await cancelOrphanSubscriptions(tx, {
      userId: params.userId,
      featureId: params.featureId,
      excludeTierId: '__no_survivor_tier__',
    })
    return { subscriptionId: currentRow.id }
  }

  if (!params.newTierId) {
    throw new Error(`applySubscriptionTransition: ${params.changeType} requires newTierId`)
  }

  // §3 ordering (load-bearing, do not reorder): cancel BEFORE upsert — a
  // same-feature tier change against the partial (userId, featureId) WHERE
  // status='active' index trips P2002 if the new-tier row is inserted while
  // the old-tier row is still active. Identical hazard, identical fix,
  // regardless of whether the move is up or down a level.
  await cancelOrphanSubscriptions(tx, {
    userId: params.userId,
    featureId: params.featureId,
    excludeTierId: params.newTierId,
  })

  await landSubscriptionItem(tx, {
    userId: params.userId,
    tierId: params.newTierId,
    featureId: params.featureId,
    status: 'active',
    periodStart: currentRow.periodStart,
    periodEnd: currentRow.periodEnd,
    stripeSubscriptionId: currentRow.stripeSubscriptionId,
  })

  const landed = await tx.subscription.findFirstOrThrow({
    where: { stripeSubscriptionId: currentRow.stripeSubscriptionId, tierId: params.newTierId },
  })
  return { subscriptionId: landed.id }
}
