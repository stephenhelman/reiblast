import { AdminActionType, Prisma, TierLevel } from '@prisma/client'
import { projectEntitlementLines, type EntitlementLine } from './comp'

type TxClient = Prisma.TransactionClient

const LEVEL_RANK: Record<TierLevel, number> = { base: 0, plus: 1, pro: 2 }

// Phase 3.5 — the admin PRODUCER. Every path here writes a PROPOSAL
// (AdminAction, + a Cart for adds) — NEVER an entitlement execution. No path
// writes/updates/cancels a Subscription row, and none writes a MemberAction
// (consent is the member's, captured later — Phase 4/5). §6a: an admin
// action is a proposal, never an execution, for any billed-shape change;
// comp (lib/engine/comp.ts) is the one admin-direct exception and does NOT
// go through this file.

// (1) STAGE ADD — carrier = Cart (Admin -> Cart -> Member). tx non-optional:
// the AdminAction + Cart + CartLine must land atomically, and the Cart's
// adminActionId join needs the AdminAction's id from inside the same tx.
export async function stageSubscriptionAddCore(
  tx: TxClient,
  params: {
    adminUserId: string
    memberUserId: string
    featureId: string
    tierId: string
    note?: string
  },
): Promise<{ adminActionId: string; cartId: string }> {
  if (!params.tierId) {
    throw new Error('stageSubscriptionAddCore: tierId is required (CartLine must have exactly one catalog ref)')
  }

  const before = await projectEntitlementLines(tx, params.memberUserId, params.featureId)
  const after: EntitlementLine[] = [...before, { featureId: params.featureId, tierId: params.tierId, status: 'active' }]

  const adminAction = await tx.adminAction.create({
    data: {
      adminUserId: params.adminUserId,
      action: 'cart_stage',
      targetType: 'user',
      targetId: params.memberUserId,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      note: params.note,
    },
  })

  // Partial-unique handling: one open cart per (userId, mode) regardless of
  // source (the index has no source column — Cart_userId_mode_open_key is on
  // (userId, mode) WHERE status='open'). If an open cart already occupies
  // this slot: admin_staged -> latest admin intent wins, expire it first in
  // THIS tx. member_self -> STOP, never silently expire a member's own cart
  // (this is the (userId,mode,source) key-collision case flagged as a future
  // schema concern; surfacing it here rather than working around it).
  const existingOpenCart = await tx.cart.findFirst({
    where: { userId: params.memberUserId, mode: 'subscription', status: 'open' },
  })
  if (existingOpenCart) {
    if (existingOpenCart.source === 'member_self') {
      throw new Error(
        `stageSubscriptionAddCore: an open member_self cart already exists for user ${params.memberUserId} (mode subscription) — refusing to expire a member's own cart. This is the (userId,mode,source) key-collision case; do not work around it.`,
      )
    }
    await tx.cart.update({ where: { id: existingOpenCart.id }, data: { status: 'expired' } })
  }

  const cart = await tx.cart.create({
    data: {
      userId: params.memberUserId,
      mode: 'subscription',
      status: 'open',
      source: 'admin_staged',
      adminActionId: adminAction.id,
    },
  })

  await tx.cartLine.create({
    data: { cartId: cart.id, tierId: params.tierId },
  })

  return { adminActionId: adminAction.id, cartId: cart.id }
}

export type ProposeChangeParams =
  | { adminUserId: string; memberUserId: string; featureId: string; changeType: 'cancel'; note?: string }
  | { adminUserId: string; memberUserId: string; featureId: string; changeType: 'tier_change'; newTierId: string; note?: string }

// (2)/(3) PROPOSE CHANGE / PROPOSE CANCEL — carrier = AdminAction only, no
// Cart (Admin -> Member, direct — the member reviews and consents to an
// in-place change, no checkout). tx non-optional for the same reason as
// every other admin-write core: the read (current row) and the AdminAction
// write must be one atomic unit.
export async function proposeSubscriptionChangeCore(
  tx: TxClient,
  params: ProposeChangeParams,
): Promise<{ adminActionId: string }> {
  const currentRow = await tx.subscription.findFirst({
    where: { userId: params.memberUserId, featureId: params.featureId, status: 'active' },
  })
  if (!currentRow) {
    throw new Error(`proposeSubscriptionChangeCore: no active subscription for user ${params.memberUserId} on feature ${params.featureId}`)
  }

  const before: EntitlementLine[] = [{ featureId: currentRow.featureId, tierId: currentRow.tierId, status: currentRow.status }]

  let action: AdminActionType
  let after: EntitlementLine[]

  if (params.changeType === 'cancel') {
    action = 'subscription_cancel'
    // Survivor reprice is DERIVED, NOT stored (§3/§5) — after describes ONLY
    // the canceled line. Survivors keep their own tier rows untouched here;
    // the reprice disclosure is computed at consent time (Phase 4, reusing
    // computeBreakDisclosure), never projected into this AdminAction.
    after = [{ featureId: currentRow.featureId, tierId: currentRow.tierId, status: 'canceled' }]
  } else {
    const [currentTier, newTier] = await Promise.all([
      tx.tier.findUniqueOrThrow({ where: { id: currentRow.tierId } }),
      tx.tier.findUniqueOrThrow({ where: { id: params.newTierId } }),
    ])
    if (LEVEL_RANK[newTier.level] === LEVEL_RANK[currentTier.level]) {
      throw new Error('proposeSubscriptionChangeCore: proposed tier is the same level as the current tier — not an upgrade or downgrade')
    }
    // Direction is the enum label, picked by comparing levels — stays
    // independently derivable from before/after too (the two always agree).
    action = LEVEL_RANK[newTier.level] > LEVEL_RANK[currentTier.level] ? 'subscription_upgrade' : 'subscription_downgrade'
    after = [{ featureId: currentRow.featureId, tierId: params.newTierId, status: 'active' }]
  }

  const adminAction = await tx.adminAction.create({
    data: {
      adminUserId: params.adminUserId,
      action,
      // targetType/targetId matches Phase 3's breakSubscriptionCore
      // convention — points at the affected Subscription row, since nothing
      // new is landed yet (this is a proposal, not an execution).
      targetType: 'subscription',
      targetId: currentRow.id,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      note: params.note,
    },
  })

  return { adminActionId: adminAction.id }
}
