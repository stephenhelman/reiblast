import { MemberActionType, Prisma, PrismaClient } from '@prisma/client'
import { computeBreakDisclosure, type SurvivorLine } from './subscriptionBreak'
import { applySubscriptionTransition } from './subscriptionTransition'
import type { EntitlementLine } from './comp'

type TxClient = Prisma.TransactionClient
type ReadClient = PrismaClient | TxClient

export type ProposalDirection = 'upgrade' | 'downgrade' | 'cancel'

export interface ProposalDisclosure {
  adminActionId: string
  featureId: string
  direction: ProposalDirection
  newTierId?: string
  disclosureText: string
  // ADDITIVE (slice 3) — the delta-ready survivor lines computeBreakDisclosure
  // already derives from the same à-la-carte price source disclosureText is
  // built from (§6b "written once, read by both"). Frozen disclosureText is
  // unchanged; this is a structured rendering of the same numbers, never a
  // second source of truth. Empty when the change doesn't break a bundle.
  breaks: boolean
  survivorLines: SurvivorLine[]
}

function directionFor(action: string): ProposalDirection {
  if (action === 'subscription_upgrade') return 'upgrade'
  if (action === 'subscription_downgrade') return 'downgrade'
  if (action === 'subscription_cancel') return 'cancel'
  throw new Error(`finalizeProposal: AdminAction action "${action}" is not a change-path proposal`)
}

function memberActionTypeFor(direction: ProposalDirection): MemberActionType {
  if (direction === 'upgrade') return 'subscription_upgrade'
  if (direction === 'downgrade') return 'subscription_downgrade'
  return 'subscription_remove'
}

// Pure read — sources the delta from AdminAction.after (the ADMIN's chosen
// proposal, not a fresh UI click) and reuses Phase 3's computeBreakDisclosure
// for the actual reprice math (never reimplemented). Callable with a plain
// PrismaClient (preview) or a tx.
export async function computeProposalDisclosure(
  client: ReadClient,
  params: { userId: string; adminActionId: string },
): Promise<ProposalDisclosure> {
  const adminAction = await client.adminAction.findUniqueOrThrow({ where: { id: params.adminActionId } })

  if (adminAction.targetType !== 'subscription') {
    throw new Error(
      `computeProposalDisclosure: AdminAction ${params.adminActionId} is not a change-path proposal (targetType ${adminAction.targetType})`,
    )
  }

  const direction = directionFor(adminAction.action)
  const before = adminAction.before as unknown as EntitlementLine[]
  const after = adminAction.after as unknown as EntitlementLine[]
  const featureId = after[0]?.featureId ?? before[0]?.featureId
  const currentTierId = before[0]?.tierId
  const proposedTierId = after[0]?.tierId
  if (!featureId || !currentTierId || !proposedTierId) {
    throw new Error(`computeProposalDisclosure: AdminAction ${params.adminActionId} projection is incomplete`)
  }

  // computeBreakDisclosure's ChangeType only distinguishes 'cancel' from
  // "apply this newTierId" — its non-cancel branch doesn't care about
  // direction, so it's reused as-is for both upgrade and downgrade.
  const breakDisclosure = await computeBreakDisclosure(client, {
    userId: params.userId,
    featureId,
    changeType: direction === 'cancel' ? 'cancel' : 'downgrade',
    newTierId: direction === 'cancel' ? undefined : proposedTierId,
  })

  const currentTier = await client.tier.findUniqueOrThrow({ where: { id: currentTierId }, include: { feature: true } })
  const proposedTier = direction === 'cancel' ? null : await client.tier.findUniqueOrThrow({ where: { id: proposedTierId } })

  // DELTA-READY, not from-less-hardcoded: names both sides of the line's own
  // price move. The FROM side is the current tier's à-la-carte rate — the
  // member's ACTUAL prior rate may have been an in-bundle discount, which
  // isn't stored server-side (§3: Subscription stores zero prices;
  // BundlePriceOverride carries only a stripePriceId, no priceCents column).
  // Never fabricates a from-price; this slot is explicit and labeled so a
  // future Stripe-aware pass can fill in the real prior invoice amount
  // without restructuring the string.
  const fromLabel = `$${(currentTier.priceCents / 100).toFixed(2)}/mo (${currentTier.level}, à la carte rate shown — your actual prior rate may have been an in-bundle discount not stored server-side)`
  const toLabel = proposedTier ? `$${(proposedTier.priceCents / 100).toFixed(2)}/mo (${proposedTier.level})` : 'canceled (no further charge on this line)'

  const adminNote =
    direction === 'cancel'
      ? " This cancellation was PROPOSED BY AN ADMIN, not requested by you — you're being asked to approve someone else's decision, not a change you initiated. Review carefully before approving."
      : ' This change was proposed by an admin for your account — review before approving.'

  const disclosureText =
    `On ${new Date().toISOString()}, an admin proposed a ${direction} on ${currentTier.feature.slug}: from ${fromLabel} to ${toLabel}.` +
    adminNote +
    (breakDisclosure.breaks ? ` ${breakDisclosure.disclosureText}` : '')

  return {
    adminActionId: params.adminActionId,
    featureId,
    direction,
    newTierId: direction === 'cancel' ? undefined : proposedTierId,
    disclosureText,
    breaks: breakDisclosure.breaks,
    survivorLines: breakDisclosure.survivorLines,
  }
}

// The write core — tx non-optional (consent + effect commit atomically, same
// rule as every other admin/member-write core). Loads the AdminAction,
// derives the delta from ITS after, calls applySubscriptionTransition for the
// entitlement change (the SAME core all three directions now share, upgrade
// included — no more bypass), then writes ITS OWN single MemberAction with
// the 'AdminAction' back-pointer (§6a) — this back-pointer, not a status
// column, is what makes the proposal FINALIZED once the live Subscription
// state also matches `after` (lib/reviewFeed.ts). Exactly ONE MemberAction
// per finalize, for all three directions — the entitlement-write/consent-
// write split (lib/engine/subscriptionTransition.ts) is what makes this
// possible without also picking up breakSubscriptionCore's own internal
// MemberAction write.
export async function finalizeProposedChangeCore(
  tx: TxClient,
  params: { userId: string; adminActionId: string; disclosureText: string },
): Promise<{ subscriptionId: string; memberActionId: string }> {
  const adminAction = await tx.adminAction.findUniqueOrThrow({ where: { id: params.adminActionId } })
  if (adminAction.targetType !== 'subscription') {
    throw new Error(
      `finalizeProposedChangeCore: AdminAction ${params.adminActionId} is not a change-path proposal (targetType ${adminAction.targetType})`,
    )
  }

  const direction = directionFor(adminAction.action)
  const after = adminAction.after as unknown as EntitlementLine[]
  const featureId = after[0]?.featureId
  const proposedTierId = after[0]?.tierId
  if (!featureId || !proposedTierId) {
    throw new Error(`finalizeProposedChangeCore: AdminAction ${params.adminActionId} projection is incomplete`)
  }

  const { subscriptionId } = await applySubscriptionTransition(tx, {
    userId: params.userId,
    featureId,
    changeType: direction,
    newTierId: direction === 'cancel' ? undefined : proposedTierId,
  })

  const memberActionType = memberActionTypeFor(direction)
  const memberAction = await tx.memberAction.create({
    data: {
      userId: params.userId,
      action: memberActionType,
      // The back-pointer (§6a) — this, not a status column, is the finalize
      // signal the feed's anti-join reads. targetId = the PROPOSAL's id, not
      // the landed subscription row.
      targetType: 'AdminAction',
      targetId: params.adminActionId,
      consent: {
        timestamp: new Date().toISOString(),
        disclosureText: params.disclosureText,
        type: memberActionType,
      } as unknown as Prisma.InputJsonValue,
      cartId: null,
    },
  })

  return { subscriptionId, memberActionId: memberAction.id }
}
