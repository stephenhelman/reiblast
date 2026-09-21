import { MemberActionType, Prisma, PrismaClient, TierLevel } from '@prisma/client'
import { qualifyBundle, type QualifyingTiers } from '@/lib/bundleQualify'
import { landSubscriptionItem, cancelOrphanSubscriptions } from './subscriptionLand'

type TxClient = Prisma.TransactionClient
type ReadClient = PrismaClient | TxClient

// Only these three features ever participate in bundle qualification (see
// lib/bundleQualify.ts) — Pack is never a bundle line (§5a) and can never
// break one.
const BUNDLE_FEATURE_SLUGS = ['score', 'ask', 'bots'] as const
type BundleFeatureSlug = (typeof BUNDLE_FEATURE_SLUGS)[number]
function isBundleFeatureSlug(slug: string): slug is BundleFeatureSlug {
  return (BUNDLE_FEATURE_SLUGS as readonly string[]).includes(slug)
}

export type ChangeType = 'downgrade' | 'cancel'

export interface SurvivorLine {
  featureSlug: string
  tierLevel: TierLevel
  priceCents: number
}

export interface BreakDisclosure {
  breaks: boolean
  disclosureText: string
  survivorLines: SurvivorLine[]
}

// Pure(ish) read — no writes. Computes whether the proposed change breaks the
// member's current bundle qualification (§5's qualifyBundle, read-only) and,
// if so, freezes the survivor lines' à-la-carte prices (Tier.priceCents,
// read directly off the Tier row — never round-tripped through Stripe) into
// disclosureText. Callable with a plain PrismaClient (preview, no tx) or a
// Prisma.TransactionClient (if a caller wants it inside its own tx).
//
// NOTE on "the delta": Subscription rows store zero prices (§3) and
// BundlePriceOverride carries only a stripePriceId, no priceCents column —
// there is no queryable record of what the member was actually paying
// in-bundle. This renders the NEW à-la-carte price per survivor line, not a
// dollar delta from the old in-bundle rate (that number isn't derivable from
// stored data without a Stripe round-trip, which this DB-only leg excludes).
export async function computeBreakDisclosure(
  client: ReadClient,
  params: { userId: string; featureId: string; changeType: ChangeType; newTierId?: string },
): Promise<BreakDisclosure> {
  const activeSubs = await client.subscription.findMany({
    where: { userId: params.userId, status: 'active' },
    include: { tier: { include: { feature: true } } },
  })

  const changedSub = activeSubs.find((s) => s.featureId === params.featureId)
  if (!changedSub) {
    throw new Error(`computeBreakDisclosure: no active subscription for user ${params.userId} on feature ${params.featureId}`)
  }

  const currentTiers: QualifyingTiers = {}
  for (const sub of activeSubs) {
    const slug = sub.tier.feature.slug
    if (isBundleFeatureSlug(slug)) currentTiers[slug] = sub.tier.level
  }

  const changedSlug = changedSub.tier.feature.slug
  const proposedTiers: QualifyingTiers = { ...currentTiers }
  if (isBundleFeatureSlug(changedSlug)) {
    if (params.changeType === 'cancel') {
      delete proposedTiers[changedSlug]
    } else {
      if (!params.newTierId) throw new Error('computeBreakDisclosure: downgrade requires newTierId')
      const newTier = await client.tier.findUniqueOrThrow({ where: { id: params.newTierId } })
      proposedTiers[changedSlug] = newTier.level
    }
  }

  const currentBundleSlug = qualifyBundle(currentTiers)
  const proposedBundleSlug = qualifyBundle(proposedTiers)
  const breaks = currentBundleSlug !== null && proposedBundleSlug === null

  if (!breaks) {
    const verb = params.changeType === 'cancel' ? 'remove' : 'change'
    return {
      breaks: false,
      disclosureText:
        `On ${new Date().toISOString()}, you requested to ${verb} this subscription line. ` +
        `This does not break your current bundle qualification — no reprice to à la carte pricing applies.`,
      survivorLines: [],
    }
  }

  // Bundle breaks: every remaining bundle-relevant line reprices to à la
  // carte (the retention lock, §5). featureId is stable across a tier
  // change (only level moves), so activeSubs' own featureId covers the
  // changed line too.
  const survivorLines: SurvivorLine[] = []
  for (const slug of Object.keys(proposedTiers) as BundleFeatureSlug[]) {
    const level = proposedTiers[slug]
    if (!level) continue
    const sub = activeSubs.find((s) => s.tier.feature.slug === slug)
    if (!sub) continue
    const tier = await client.tier.findUniqueOrThrow({ where: { featureId_level: { featureId: sub.featureId, level } } })
    survivorLines.push({ featureSlug: slug, tierLevel: level, priceCents: tier.priceCents })
  }

  const lineText = survivorLines
    .map((l) => `${l.featureSlug} (${l.tierLevel}): $${(l.priceCents / 100).toFixed(2)}/mo à la carte`)
    .join('; ')

  return {
    breaks: true,
    disclosureText:
      `On ${new Date().toISOString()}, you requested a change that breaks your ${currentBundleSlug} bundle. ` +
      `Your remaining subscription lines will reprice to à la carte pricing: ${lineText}. ` +
      `(This reflects the new à-la-carte rate only — your prior in-bundle rate is not stored server-side.)`,
    survivorLines,
  }
}

function memberActionTypeFor(changeType: ChangeType): MemberActionType {
  // Phase 3 records the STRUCTURAL action the member took (downgrade vs
  // remove) as the MemberActionType — bundle_break stays reserved in the
  // enum for a future explicit bundle-level action, since this core always
  // operates on one (userId, featureId) line at a time. Whether the change
  // broke a bundle is what disclosureText documents, not the `action` enum.
  return changeType === 'cancel' ? 'subscription_remove' : 'subscription_downgrade'
}

// The write core — mirrors lib/engine/comp.ts's shape (plain args, tx
// NON-OPTIONAL: consent + effect must commit atomically, so this never opens
// its own transaction). Does the §3-ordered entitlement write (reusing the
// shared cores, never reimplemented) + the MemberAction write, nothing else.
// disclosureText is a REQUIRED input — this function does not compute it;
// the caller (server action) already showed the member this exact text via
// computeBreakDisclosure and is passing through what was approved.
export async function breakSubscriptionCore(
  tx: TxClient,
  params: {
    userId: string
    featureId: string
    changeType: ChangeType
    newTierId?: string
    disclosureText: string
  },
): Promise<{ subscriptionId: string; memberActionId: string }> {
  const currentRow = await tx.subscription.findFirst({
    where: { userId: params.userId, featureId: params.featureId, status: 'active' },
  })
  if (!currentRow) {
    throw new Error(`breakSubscriptionCore: no active subscription for user ${params.userId} on feature ${params.featureId}`)
  }

  let landedRowId: string

  if (params.changeType === 'downgrade') {
    if (!params.newTierId) throw new Error('breakSubscriptionCore: downgrade requires newTierId')

    // §3 ordering (load-bearing, do not reorder): cancel BEFORE upsert — a
    // same-feature tier change against the partial (userId, featureId)
    // WHERE status='active' index trips P2002 if the new-tier row is
    // inserted while the old-tier row is still active.
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
    landedRowId = landed.id
  } else {
    // cancel: no survivor tier on this feature slot. Reuse the shared
    // cancel-orphan helper (never reimplemented) with a sentinel
    // excludeTierId that can never match a real Tier row, so every active
    // row on this (userId, featureId) slot — exactly one, per
    // replace-not-stack — is canceled and nothing is landed.
    await cancelOrphanSubscriptions(tx, {
      userId: params.userId,
      featureId: params.featureId,
      excludeTierId: '__no_survivor_tier__',
    })
    landedRowId = currentRow.id
  }

  const action = memberActionTypeFor(params.changeType)

  const memberAction = await tx.memberAction.create({
    data: {
      userId: params.userId,
      action,
      targetType: 'subscription',
      targetId: landedRowId,
      consent: {
        timestamp: new Date().toISOString(),
        disclosureText: params.disclosureText,
        type: action,
      } as unknown as Prisma.InputJsonValue,
      cartId: null,
    },
  })

  return { subscriptionId: landedRowId, memberActionId: memberAction.id }
}
