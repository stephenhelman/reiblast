import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { proposeSubscriptionChangeCore } from '../adminProposals'
import { computeProposalDisclosure, finalizeProposedChangeCore } from '../finalizeProposal'
import { getOpenChangesForMember } from '../../reviewFeed'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('finalizeProposal (Phase 4 — change-path finalize)', () => {
  let adminUserId: string
  let scoreBase: { id: string; featureId: string }
  let scorePlus: { id: string; featureId: string }
  let scorePro: { id: string; featureId: string }

  beforeAll(async () => {
    adminUserId = await createDisposableUser()
    scoreBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'base' } })
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
        stripeSubscriptionId: `sub_fake_finalize_${userId}`,
      },
    })
    return userId
  }

  it('finalize upgrade (plus -> pro): entitlement lands correctly (§3 order, no P2002), MemberAction targetType AdminAction + correct targetId + delta-ready disclosure, one tx', async () => {
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

      const disclosure = await computeProposalDisclosure(testPrisma, { userId, adminActionId })
      expect(disclosure.direction).toBe('upgrade')
      expect(disclosure.disclosureText).toContain('from $')
      expect(disclosure.disclosureText).toContain('to $')
      expect(disclosure.disclosureText).toContain('proposed by an admin')

      await testPrisma.$transaction((tx) =>
        finalizeProposedChangeCore(tx as unknown as Prisma.TransactionClient, {
          userId,
          adminActionId,
          disclosureText: disclosure.disclosureText,
        }),
      )

      const rows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
      const plusRow = rows.find((r) => r.tierId === scorePlus.id)
      const proRow = rows.find((r) => r.tierId === scorePro.id)
      expect(plusRow?.status).toBe('canceled')
      expect(proRow?.status).toBe('active')

      const memberAction = await testPrisma.memberAction.findFirstOrThrow({
        where: { userId, targetType: 'AdminAction', targetId: adminActionId },
      })
      expect(memberAction.action).toBe('subscription_upgrade')
      expect(memberAction.cartId).toBeNull()
      const consent = memberAction.consent as { disclosureText: string; type: string }
      expect(consent.type).toBe('subscription_upgrade')
      expect(consent.disclosureText).toBe(disclosure.disclosureText)

      // Exactly ONE MemberAction for this finalize — the entitlement-write/
      // consent-write split means applySubscriptionTransition writes none of
      // its own, so there's no second, wrongly-typed row to pick up.
      const allMemberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(allMemberActions).toHaveLength(1)
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('finalize downgrade (plus -> base): §3 order, no P2002, MemberAction targetType AdminAction + correct targetId', async () => {
    const userId = await seedMemberOnScorePlus()
    try {
      const { adminActionId } = await testPrisma.$transaction((tx) =>
        proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: scorePlus.featureId,
          changeType: 'tier_change',
          newTierId: scoreBase.id,
        }),
      )

      const disclosure = await computeProposalDisclosure(testPrisma, { userId, adminActionId })
      expect(disclosure.direction).toBe('downgrade')

      await testPrisma.$transaction((tx) =>
        finalizeProposedChangeCore(tx as unknown as Prisma.TransactionClient, {
          userId,
          adminActionId,
          disclosureText: disclosure.disclosureText,
        }),
      )

      const rows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
      const plusRow = rows.find((r) => r.tierId === scorePlus.id)
      const baseRow = rows.find((r) => r.tierId === scoreBase.id)
      expect(plusRow?.status).toBe('canceled')
      expect(baseRow?.status).toBe('active')

      const memberAction = await testPrisma.memberAction.findFirstOrThrow({
        where: { userId, targetType: 'AdminAction', targetId: adminActionId },
      })
      expect(memberAction.action).toBe('subscription_downgrade')

      // THE BUG BEING FIXED: exactly ONE MemberAction, targetType
      // 'AdminAction' — not two, and no stray targetType:'subscription' row
      // (breakSubscriptionCore used to also write one internally before the
      // entitlement-write/consent-write split).
      const allMemberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(allMemberActions).toHaveLength(1)
      expect(allMemberActions[0]?.targetType).toBe('AdminAction')
      expect(allMemberActions.some((m) => m.targetType === 'subscription')).toBe(false)
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('finalize cancel: line canceled, MemberAction subscription_remove with AdminAction back-pointer, disclosure notes it was admin-proposed', async () => {
    const userId = await seedMemberOnScorePlus()
    try {
      const { adminActionId } = await testPrisma.$transaction((tx) =>
        proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          memberUserId: userId,
          featureId: scorePlus.featureId,
          changeType: 'cancel',
        }),
      )

      const disclosure = await computeProposalDisclosure(testPrisma, { userId, adminActionId })
      expect(disclosure.direction).toBe('cancel')
      expect(disclosure.disclosureText).toContain('PROPOSED BY AN ADMIN')

      await testPrisma.$transaction((tx) =>
        finalizeProposedChangeCore(tx as unknown as Prisma.TransactionClient, {
          userId,
          adminActionId,
          disclosureText: disclosure.disclosureText,
        }),
      )

      const row = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: scorePlus.featureId } })
      expect(row.status).toBe('canceled')

      const memberAction = await testPrisma.memberAction.findFirstOrThrow({
        where: { userId, targetType: 'AdminAction', targetId: adminActionId },
      })
      expect(memberAction.action).toBe('subscription_remove')

      // Exactly ONE MemberAction, targetType 'AdminAction' — same fix as
      // downgrade, no stray 'subscription' row.
      const allMemberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(allMemberActions).toHaveLength(1)
      expect(allMemberActions[0]?.targetType).toBe('AdminAction')
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('atomicity: a forced failure after the entitlement write rolls back the whole tx — MemberAction absent, entitlement unchanged', async () => {
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

      await expect(
        testPrisma.$transaction(async (tx) => {
          await finalizeProposedChangeCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            adminActionId,
            disclosureText: 'forced-failure-test',
          })
          throw new Error('forced failure after the entitlement write')
        }),
      ).rejects.toThrow('forced failure')

      const rows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.tierId).toBe(scorePlus.id)
      expect(rows[0]?.status).toBe('active')

      const memberAction = await testPrisma.memberAction.findFirst({
        where: { userId, targetType: 'AdminAction', targetId: adminActionId },
      })
      expect(memberAction).toBeNull()

      // The whole tx rolled back — the proposal is still pending in the feed.
      const items = await getOpenChangesForMember(testPrisma, userId)
      const item = items.find((i) => i.kind === 'change' && i.adminActionId === adminActionId)
      expect(item?.state).toBe('pending')
    } finally {
      await teardownDisposableUser(userId)
    }
  })
})
