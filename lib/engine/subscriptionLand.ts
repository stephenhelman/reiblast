import { Prisma, SubscriptionStatus } from '@prisma/client'

type TxClient = Prisma.TransactionClient

// Status-agnostic per-item locate + upsert for ONE (stripeSubscriptionId,
// tierId) slot — the core extracted from handleSubscriptionEvent (see
// REItools-Architecture-v3.md §3). tx is NON-OPTIONAL: unlike fund()'s dual
// client/tx shape, every caller of this core (webhook adapter, comp) must
// commit the write atomically with an orphan-cancel and/or an AdminAction, so
// this never opens its own transaction and never accepts a bare PrismaClient.
//
// Owns ONLY the locate+upsert for a single item: findFirst on
// (stripeSubscriptionId, tierId) with NO status filter — a canceled row still
// occupies its slot, so a downgrade back to a previously-held tier must
// RESURRECT that row (update) rather than create() a duplicate, which would
// trip the slot's own uniqueness. Does not cancel orphans, does not resolve
// prices — callers do both before/around calling this per current item.
export async function landSubscriptionItem(
  tx: TxClient,
  params: {
    userId: string
    tierId: string
    featureId: string
    periodStart: Date
    periodEnd: Date
    status: SubscriptionStatus
    stripeSubscriptionId: string | null
  },
): Promise<void> {
  const data = {
    userId: params.userId,
    tierId: params.tierId,
    featureId: params.featureId,
    status: params.status,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    stripeSubscriptionId: params.stripeSubscriptionId,
  }

  const existing = await tx.subscription.findFirst({
    where: { stripeSubscriptionId: params.stripeSubscriptionId, tierId: params.tierId },
  })

  if (existing) {
    await tx.subscription.update({ where: { id: existing.id }, data })
  } else {
    await tx.subscription.create({ data })
  }
}

// Shared cancel-orphan helper, parameterized by scope key — the webhook
// adapter scopes by stripeSubscriptionId (cancel rows on that sub not among
// the current item set); the comp caller scopes by {userId, featureId}
// (cancel the active row on that feature not equal to the comped tier, since
// a comped sub has no stripeSubscriptionId to scope by — enforces
// replace-not-stack, see §3). Cancel MUST run before any upsert in the same
// transaction — the partial (userId, featureId) WHERE status='active' index
// is immediate, not deferrable, so insert-before-cancel on a same-feature
// tier change trips P2002.
export async function cancelOrphanSubscriptions(
  tx: TxClient,
  scope: { stripeSubscriptionId: string; excludeTierIds: string[] } | { userId: string; featureId: string; excludeTierId: string },
): Promise<void> {
  if ('stripeSubscriptionId' in scope) {
    await tx.subscription.updateMany({
      where: {
        stripeSubscriptionId: scope.stripeSubscriptionId,
        tierId: { notIn: scope.excludeTierIds },
        status: { not: 'canceled' },
      },
      data: { status: 'canceled' },
    })
  } else {
    await tx.subscription.updateMany({
      where: {
        userId: scope.userId,
        featureId: scope.featureId,
        tierId: { not: scope.excludeTierId },
        status: 'active',
      },
      data: { status: 'canceled' },
    })
  }
}
