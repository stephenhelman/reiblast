import { Prisma } from '@prisma/client'
import { landSubscriptionItem, cancelOrphanSubscriptions } from './subscriptionLand'

type TxClient = Prisma.TransactionClient

export interface EntitlementLine {
  featureId: string
  tierId: string
  status: string
}

// Shared projection — the Subscription-row shape every AdminAction
// before/after uses (§6a: "the same projection read off Subscription rows
// ... NOT a diff"). Exported so other admin-write cores (lib/engine/
// adminProposals.ts) reuse this exact read instead of re-deriving it.
export async function projectEntitlementLines(tx: TxClient, userId: string, featureId: string): Promise<EntitlementLine[]> {
  const rows = await tx.subscription.findMany({ where: { userId, featureId } })
  return rows.map((r) => ({ featureId: r.featureId, tierId: r.tierId, status: r.status }))
}

// Comp-free-month: an admin grants a member a tier on a feature directly, no
// Stripe, no member consent (the admin-direct exception — see
// REItools-Architecture-v3.md §13 v1.5 write plan / AdminActionType.
// subscription_comp). Caller-agnostic domain args, mirroring fund()'s shape;
// unlike fund(), tx is NON-OPTIONAL (same rule as landSubscriptionItem — this
// must commit atomically with the AdminAction write, never partially).
//
// In ONE transaction: (1) cancel-orphan scoped by {userId, featureId}
// (replace-not-stack — an existing active sub on this feature is canceled);
// (2) land the comped tier via the core, synthetic/null stripeSubscriptionId;
// (3) write an executed (not proposed) AdminAction, target = the member,
// before/after = the Subscription-row projection for that feature. No ledger
// write — comp grants access, not credits (§6 audience split; AdminAction
// carries no ledger fields).
export async function compFreeMonth(
  tx: TxClient,
  params: {
    adminUserId: string
    userId: string
    tierId: string
    featureId: string
    periodStart: Date
    periodEnd: Date
    note?: string
  },
): Promise<void> {
  const before = await projectEntitlementLines(tx, params.userId, params.featureId)

  await cancelOrphanSubscriptions(tx, {
    userId: params.userId,
    featureId: params.featureId,
    excludeTierId: params.tierId,
  })

  await landSubscriptionItem(tx, {
    userId: params.userId,
    tierId: params.tierId,
    featureId: params.featureId,
    status: 'active',
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    stripeSubscriptionId: null,
  })

  const after = await projectEntitlementLines(tx, params.userId, params.featureId)

  await tx.adminAction.create({
    data: {
      adminUserId: params.adminUserId,
      action: 'subscription_comp',
      targetType: 'user',
      targetId: params.userId,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      note: params.note,
    },
  })
}
