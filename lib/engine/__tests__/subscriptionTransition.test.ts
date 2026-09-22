import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { applySubscriptionTransition } from '../subscriptionTransition'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('applySubscriptionTransition (entitlement-only core, no MemberAction)', () => {
  let scoreBase: { id: string; featureId: string }
  let scorePlus: { id: string; featureId: string }
  let scorePro: { id: string; featureId: string }

  beforeAll(async () => {
    scoreBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'base' } })
    scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
    scorePro = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } })
  })

  async function seedMemberOnTier(tier: { id: string; featureId: string }): Promise<{ userId: string; stripeSubscriptionId: string }> {
    const userId = await createDisposableUser()
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)
    const stripeSubscriptionId = `sub_fake_transition_${userId}`
    await testPrisma.subscription.create({
      data: { userId, tierId: tier.id, featureId: tier.featureId, status: 'active', periodStart, periodEnd, stripeSubscriptionId },
    })
    return { userId, stripeSubscriptionId }
  }

  it('upgrade: cancels the old tier row, lands the new one active, no MemberAction written', async () => {
    const { userId } = await seedMemberOnTier(scorePlus)
    try {
      const result = await testPrisma.$transaction((tx) =>
        applySubscriptionTransition(tx as unknown as Prisma.TransactionClient, {
          userId,
          featureId: scorePlus.featureId,
          changeType: 'upgrade',
          newTierId: scorePro.id,
        }),
      )

      const rows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
      const plusRow = rows.find((r) => r.tierId === scorePlus.id)
      const proRow = rows.find((r) => r.tierId === scorePro.id)
      expect(plusRow?.status).toBe('canceled')
      expect(proRow?.status).toBe('active')
      expect(result.subscriptionId).toBe(proRow?.id)

      const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(memberActions).toHaveLength(0)
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('downgrade: cancels the old tier row, lands the new one active, §3 order (no P2002), no MemberAction written', async () => {
    const { userId } = await seedMemberOnTier(scorePlus)
    try {
      const result = await testPrisma.$transaction((tx) =>
        applySubscriptionTransition(tx as unknown as Prisma.TransactionClient, {
          userId,
          featureId: scorePlus.featureId,
          changeType: 'downgrade',
          newTierId: scoreBase.id,
        }),
      )

      const rows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
      const plusRow = rows.find((r) => r.tierId === scorePlus.id)
      const baseRow = rows.find((r) => r.tierId === scoreBase.id)
      expect(plusRow?.status).toBe('canceled')
      expect(baseRow?.status).toBe('active')
      expect(result.subscriptionId).toBe(baseRow?.id)

      const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(memberActions).toHaveLength(0)
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('resurrect-by-id still holds on a downgrade-back: upgrade to pro, then downgrade back to plus resurrects the SAME plus row, no duplicate, no P2002', async () => {
    const { userId } = await seedMemberOnTier(scorePlus)
    try {
      const plusRowBefore = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: scorePlus.featureId, tierId: scorePlus.id } })

      await testPrisma.$transaction((tx) =>
        applySubscriptionTransition(tx as unknown as Prisma.TransactionClient, {
          userId,
          featureId: scorePlus.featureId,
          changeType: 'upgrade',
          newTierId: scorePro.id,
        }),
      )

      await expect(
        testPrisma.$transaction((tx) =>
          applySubscriptionTransition(tx as unknown as Prisma.TransactionClient, {
            userId,
            featureId: scorePlus.featureId,
            changeType: 'downgrade',
            newTierId: scorePlus.id,
          }),
        ),
      ).resolves.not.toThrow()

      const rows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId, tierId: scorePlus.id } })
      expect(rows).toHaveLength(1) // resurrected, not duplicated
      expect(rows[0]?.id).toBe(plusRowBefore.id)
      expect(rows[0]?.status).toBe('active')

      const proRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: scorePlus.featureId, tierId: scorePro.id } })
      expect(proRow.status).toBe('canceled')

      const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(memberActions).toHaveLength(0)
    } finally {
      await teardownDisposableUser(userId)
    }
  })

  it('cancel: transitions status to canceled, no MemberAction written', async () => {
    const { userId } = await seedMemberOnTier(scorePlus)
    try {
      const result = await testPrisma.$transaction((tx) =>
        applySubscriptionTransition(tx as unknown as Prisma.TransactionClient, {
          userId,
          featureId: scorePlus.featureId,
          changeType: 'cancel',
        }),
      )

      const row = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: scorePlus.featureId } })
      expect(row.status).toBe('canceled')
      expect(result.subscriptionId).toBe(row.id)

      const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
      expect(memberActions).toHaveLength(0)
    } finally {
      await teardownDisposableUser(userId)
    }
  })
})
