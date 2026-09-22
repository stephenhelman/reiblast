import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { stageSubscriptionAddCore, proposeSubscriptionChangeCore } from '../adminProposals'
import { finalizeProposedChangeCore } from '../finalizeProposal'
import { getOpenChangesForMember } from '../../reviewFeed'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('reviewFeed (Phase 4 — the union feed + three-state derivation)', () => {
  let adminUserId: string
  let askBase: { id: string; featureId: string }
  let scorePlus: { id: string; featureId: string }
  let scorePro: { id: string; featureId: string }

  beforeAll(async () => {
    adminUserId = await createDisposableUser()
    askBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } })
    scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
    scorePro = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } })
  })

  afterAll(async () => {
    await teardownDisposableUser(adminUserId)
  })

  async function seedMemberOnScorePlus(): Promise<string> {
    const userId = await createDisposableUser()
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)
    await testPrisma.subscription.create({
      data: {
        userId,
        tierId: scorePlus.id,
        featureId: scorePlus.featureId,
        status: 'active',
        periodStart,
        periodEnd,
        stripeSubscriptionId: `sub_fake_feed_${userId}`,
      },
    })
    return userId
  }

  it('a pending change proposal appears in the feed as state=pending; after finalize it drops off entirely', async () => {
    const userId = await seedMemberOnScorePlus()
    try {
      const { adminActionId } = await testPrisma.$transaction((tx) =>
        proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: scorePlus.featureId,
          changeType: 'tier_change',
          newTierId: scorePro.id,
        }),
      )

      const before = await getOpenChangesForMember(testPrisma, userId)
      const item = before.find((i) => i.kind === 'change' && i.adminActionId === adminActionId)
      expect(item).toBeDefined()
      expect(item?.state).toBe('pending')

      await testPrisma.$transaction((tx) =>
        finalizeProposedChangeCore(tx as unknown as Prisma.TransactionClient, {
          userId,
          adminActionId,
          disclosureText: 'test disclosure',
        }),
      )

      const after = await getOpenChangesForMember(testPrisma, userId)
      expect(after.find((i) => i.kind === 'change' && i.adminActionId === adminActionId)).toBeUndefined()
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('an open admin_staged cart appears in the feed as an add item, state=pending', async () => {
    const userId = await createDisposableUser()
    try {
      const { cartId, adminActionId } = await testPrisma.$transaction((tx) =>
        stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: askBase.featureId,
          tierId: askBase.id,
        }),
      )

      const items = await getOpenChangesForMember(testPrisma, userId)
      const item = items.find((i) => i.kind === 'add' && i.cartId === cartId)
      expect(item).toBeDefined()
      expect(item?.state).toBe('pending')
      if (item?.kind === 'add') {
        expect(item.adminActionId).toBe(adminActionId)
        expect(item.lines).toHaveLength(1)
        expect(item.lines[0]?.tierId).toBe(askBase.id)
      }
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('a MemberAction back-pointer exists but the live Subscription does NOT yet match `after` -> state=consented (constructed directly)', async () => {
    const userId = await seedMemberOnScorePlus()
    try {
      const { adminActionId } = await testPrisma.$transaction((tx) =>
        proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: scorePlus.featureId,
          changeType: 'tier_change',
          newTierId: scorePro.id,
        }),
      )

      // Construct the consented-but-not-landed state directly: write the
      // back-pointer WITHOUT running the entitlement change (this can't arise
      // from calling finalizeProposedChangeCore itself, which is atomic —
      // it's here to prove the derivation logic handles it correctly).
      await testPrisma.memberAction.create({
        data: {
          userId,
          action: 'subscription_upgrade',
          targetType: 'AdminAction',
          targetId: adminActionId,
          consent: { timestamp: new Date().toISOString(), disclosureText: 'approved, not yet landed', type: 'subscription_upgrade' },
          cartId: null,
        },
      })

      const items = await getOpenChangesForMember(testPrisma, userId)
      const item = items.find((i) => i.kind === 'change' && i.adminActionId === adminActionId)
      expect(item).toBeDefined()
      expect(item?.state).toBe('consented')

      // Score is still on plus (unchanged) — confirms this is genuinely the
      // not-yet-landed case, not a false positive.
      const row = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: scorePlus.featureId } })
      expect(row.tierId).toBe(scorePlus.id)
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('anti-join correctness: a proposal WITH a referencing MemberAction is excluded from pending; two proposals for one member do not cross-match', async () => {
    const userId = await seedMemberOnScorePlus()
    try {
      const { adminActionId: firstProposalId } = await testPrisma.$transaction((tx) =>
        proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: scorePlus.featureId,
          changeType: 'cancel',
        }),
      )

      // A second, independent proposal on the same feature (admin changed
      // their mind) — both exist as AdminAction rows; only the first has a
      // MemberAction referencing it.
      const { adminActionId: secondProposalId } = await testPrisma.$transaction((tx) =>
        proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: scorePlus.featureId,
          changeType: 'tier_change',
          newTierId: scorePro.id,
        }),
      )

      await testPrisma.memberAction.create({
        data: {
          userId,
          action: 'subscription_remove',
          targetType: 'AdminAction',
          targetId: firstProposalId,
          consent: { timestamp: new Date().toISOString(), disclosureText: 'responded to the cancel proposal', type: 'subscription_remove' },
          cartId: null,
        },
      })

      const items = await getOpenChangesForMember(testPrisma, userId)
      const changeItems = items.filter((i) => i.kind === 'change')

      const first = changeItems.find((i) => i.adminActionId === firstProposalId)
      const second = changeItems.find((i) => i.adminActionId === secondProposalId)

      // first has a MemberAction, but the entitlement never actually landed
      // (still active on scorePlus) -> consented, not finalized/dropped.
      expect(first?.state).toBe('consented')
      // second has NO MemberAction referencing it -> pending, and must not
      // pick up the first proposal's MemberAction (no cross-matching).
      expect(second?.state).toBe('pending')
    } finally {
      await teardownDisposableUser(userId)
    }
  })
})
