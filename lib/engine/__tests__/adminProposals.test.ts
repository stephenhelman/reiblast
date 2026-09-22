import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { stageSubscriptionAddCore, proposeSubscriptionChangeCore } from '../adminProposals'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('adminProposals (Phase 3.5 — admin change PRODUCER, proposals only)', () => {
  let adminUserId: string
  let askBase: { id: string; featureId: string }
  let scorePlus: { id: string; featureId: string }
  let scorePro: { id: string; featureId: string }
  let scoreBase: { id: string; featureId: string }

  beforeAll(async () => {
    adminUserId = await createDisposableUser()
    askBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } })
    scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
    scorePro = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } })
    scoreBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'base' } })
  })

  afterAll(async () => {
    await teardownDisposableUser(adminUserId)
  })

  describe('stageSubscriptionAddCore', () => {
    it('writes AdminAction(cart_stage) with before/after projection, Cart(admin_staged, open) + CartLine(tierId), and NO Subscription row, all in one tx', async () => {
      const memberUserId = await createDisposableUser()
      try {
        const result = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId,
            featureId: askBase.featureId,
            tierId: askBase.id,
          }),
        )
        if (!('ok' in result)) throw new Error('expected ok result, got requiresOverrideConfirm')

        const adminAction = await testPrisma.adminAction.findUniqueOrThrow({ where: { id: result.adminActionId } })
        expect(adminAction.action).toBe('cart_stage')
        expect(adminAction.targetType).toBe('user')
        expect(adminAction.targetId).toBe(memberUserId)
        expect(adminAction.before).toEqual([])
        expect(adminAction.after).toEqual([{ featureId: askBase.featureId, tierId: askBase.id, status: 'active' }])

        const cart = await testPrisma.cart.findUniqueOrThrow({ where: { id: result.cartId } })
        expect(cart.source).toBe('admin_staged')
        expect(cart.mode).toBe('subscription')
        expect(cart.status).toBe('open')
        expect(cart.adminActionId).toBe(result.adminActionId)

        const lines = await testPrisma.cartLine.findMany({ where: { cartId: cart.id } })
        expect(lines).toHaveLength(1)
        expect(lines[0]?.tierId).toBe(askBase.id)
        expect(lines[0]?.creditPackId).toBeNull()

        const subs = await testPrisma.subscription.findMany({ where: { userId: memberUserId } })
        expect(subs).toHaveLength(0) // no entitlement execution

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId: memberUserId } })
        expect(memberActions).toHaveLength(0) // consent is the member's, not written here
      } finally {
        await teardownDisposableUser(memberUserId)
      }
    })

    it('when an open admin_staged cart already exists for (userId,mode): expires the prior one, still exactly one open cart', async () => {
      const memberUserId = await createDisposableUser()
      try {
        const first = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId,
            featureId: askBase.featureId,
            tierId: askBase.id,
          }),
        )
        if (!('ok' in first)) throw new Error('expected ok result, got requiresOverrideConfirm')

        const second = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId,
            featureId: scorePlus.featureId,
            tierId: scorePlus.id,
          }),
        )
        if (!('ok' in second)) throw new Error('expected ok result, got requiresOverrideConfirm')

        const firstCart = await testPrisma.cart.findUniqueOrThrow({ where: { id: first.cartId } })
        expect(firstCart.status).toBe('expired')

        const secondCart = await testPrisma.cart.findUniqueOrThrow({ where: { id: second.cartId } })
        expect(secondCart.status).toBe('open')

        const openCarts = await testPrisma.cart.findMany({ where: { userId: memberUserId, mode: 'subscription', status: 'open' } })
        expect(openCarts).toHaveLength(1)
        expect(openCarts[0]?.id).toBe(second.cartId)
      } finally {
        await teardownDisposableUser(memberUserId)
      }
    })
  })

  describe('proposeSubscriptionChangeCore', () => {
    async function seedActiveScorePlusMember(): Promise<string> {
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
          stripeSubscriptionId: `sub_fake_propose_${userId}`,
        },
      })
      return userId
    }

    it('propose upgrade (plus -> pro): action=subscription_upgrade, correct before/after, targetType subscription, NO Subscription mutation', async () => {
      const memberUserId = await seedActiveScorePlusMember()
      try {
        const currentRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId: memberUserId, featureId: scorePlus.featureId } })

        const result = await testPrisma.$transaction((tx) =>
          proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId,
            featureId: scorePlus.featureId,
            changeType: 'tier_change',
            newTierId: scorePro.id,
          }),
        )

        const adminAction = await testPrisma.adminAction.findUniqueOrThrow({ where: { id: result.adminActionId } })
        expect(adminAction.action).toBe('subscription_upgrade')
        expect(adminAction.targetType).toBe('subscription')
        expect(adminAction.targetId).toBe(currentRow.id)
        expect(adminAction.before).toEqual([{ featureId: scorePlus.featureId, tierId: scorePlus.id, status: 'active' }])
        expect(adminAction.after).toEqual([{ featureId: scorePlus.featureId, tierId: scorePro.id, status: 'active' }])

        const unchanged = await testPrisma.subscription.findUniqueOrThrow({ where: { id: currentRow.id } })
        expect(unchanged.tierId).toBe(scorePlus.id) // still the OLD tier — no execution happened
        expect(unchanged.status).toBe('active')

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId: memberUserId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(memberUserId)
      }
    })

    it('propose downgrade (plus -> base): action=subscription_downgrade, correct before/after, NO Subscription mutation', async () => {
      const memberUserId = await seedActiveScorePlusMember()
      try {
        const currentRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId: memberUserId, featureId: scorePlus.featureId } })

        const result = await testPrisma.$transaction((tx) =>
          proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId,
            featureId: scorePlus.featureId,
            changeType: 'tier_change',
            newTierId: scoreBase.id,
          }),
        )

        const adminAction = await testPrisma.adminAction.findUniqueOrThrow({ where: { id: result.adminActionId } })
        expect(adminAction.action).toBe('subscription_downgrade')
        expect(adminAction.before).toEqual([{ featureId: scorePlus.featureId, tierId: scorePlus.id, status: 'active' }])
        expect(adminAction.after).toEqual([{ featureId: scorePlus.featureId, tierId: scoreBase.id, status: 'active' }])

        const unchanged = await testPrisma.subscription.findUniqueOrThrow({ where: { id: currentRow.id } })
        expect(unchanged.tierId).toBe(scorePlus.id)

        const subs = await testPrisma.subscription.findMany({ where: { userId: memberUserId } })
        expect(subs).toHaveLength(1) // no new row landed either
      } finally {
        await teardownDisposableUser(memberUserId)
      }
    })

    it('propose cancel: action=subscription_cancel, after = the canceled line ONLY (no survivor projection), NO Subscription mutation', async () => {
      const memberUserId = await seedActiveScorePlusMember()
      try {
        const currentRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId: memberUserId, featureId: scorePlus.featureId } })

        const result = await testPrisma.$transaction((tx) =>
          proposeSubscriptionChangeCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId,
            featureId: scorePlus.featureId,
            changeType: 'cancel',
          }),
        )

        const adminAction = await testPrisma.adminAction.findUniqueOrThrow({ where: { id: result.adminActionId } })
        expect(adminAction.action).toBe('subscription_cancel')
        expect(adminAction.before).toEqual([{ featureId: scorePlus.featureId, tierId: scorePlus.id, status: 'active' }])
        expect(adminAction.after).toEqual([{ featureId: scorePlus.featureId, tierId: scorePlus.id, status: 'canceled' }])

        const unchanged = await testPrisma.subscription.findUniqueOrThrow({ where: { id: currentRow.id } })
        expect(unchanged.status).toBe('active') // STILL active — proposal only, no execution

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId: memberUserId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(memberUserId)
      }
    })
  })
})
