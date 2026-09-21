import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { computeBreakDisclosure, breakSubscriptionCore } from '../subscriptionBreak'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('subscriptionBreak (phase 3 — member break/cancel gate)', () => {
  let scorePlus: { id: string; featureId: string }
  let scoreBase: { id: string }
  let askBase: { id: string; featureId: string }

  beforeAll(async () => {
    scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
    scoreBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'base' } })
    askBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } })
  })

  async function seedBundlePlusMember(): Promise<string> {
    const userId = await createDisposableUser()
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)
    const stripeSubscriptionId = `sub_fake_break_${userId}`

    // score/plus + ask/base on one sub — qualifies bundle-plus (§5).
    await testPrisma.subscription.createMany({
      data: [
        {
          userId,
          tierId: scorePlus.id,
          featureId: scorePlus.featureId,
          status: 'active',
          periodStart,
          periodEnd,
          stripeSubscriptionId,
        },
        {
          userId,
          tierId: askBase.id,
          featureId: askBase.featureId,
          status: 'active',
          periodStart,
          periodEnd,
          stripeSubscriptionId,
        },
      ],
    })
    return userId
  }

  describe('downgrade that BREAKS the bundle (score plus -> base drops below the plus floor)', () => {
    let userId: string

    beforeAll(async () => {
      userId = await seedBundlePlusMember()
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('lands the new tier (§3 order, no P2002), writes a subscription_downgrade MemberAction with cartId null and the survivor à-la-carte price frozen in disclosureText, both in one tx', async () => {
      const disclosure = await computeBreakDisclosure(testPrisma, {
        userId,
        featureId: scorePlus.featureId,
        changeType: 'downgrade',
        newTierId: scoreBase.id,
      })
      expect(disclosure.breaks).toBe(true)
      // ask/base survives — its à-la-carte price must be frozen into the text.
      const askTier = await testPrisma.tier.findUniqueOrThrow({ where: { id: askBase.id } })
      expect(disclosure.disclosureText).toContain(`$${(askTier.priceCents / 100).toFixed(2)}`)
      expect(disclosure.survivorLines.some((l) => l.featureSlug === 'ask')).toBe(true)

      await expect(
        testPrisma.$transaction(async (tx) => {
          await breakSubscriptionCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            featureId: scorePlus.featureId,
            changeType: 'downgrade',
            newTierId: scoreBase.id,
            disclosureText: disclosure.disclosureText,
          })
        }),
      ).resolves.not.toThrow()

      const scoreRows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
      const plusRow = scoreRows.find((r) => r.tierId === scorePlus.id)
      const baseRow = scoreRows.find((r) => r.tierId === scoreBase.id)
      expect(plusRow?.status).toBe('canceled')
      expect(baseRow?.status).toBe('active')

      const askRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: askBase.featureId } })
      expect(askRow.status).toBe('active') // untouched line stays active

      const memberAction = await testPrisma.memberAction.findFirstOrThrow({
        where: { userId, action: 'subscription_downgrade' },
        orderBy: { createdAt: 'desc' },
      })
      expect(memberAction.cartId).toBeNull()
      expect(memberAction.targetType).toBe('subscription')
      expect(memberAction.targetId).toBe(baseRow?.id)
      const consent = memberAction.consent as { timestamp: string; disclosureText: string; type: string }
      expect(consent.type).toBe('subscription_downgrade')
      expect(consent.disclosureText).toBe(disclosure.disclosureText)
      expect(typeof consent.timestamp).toBe('string')
    })
  })

  describe('cancel that BREAKS the bundle', () => {
    let userId: string

    beforeAll(async () => {
      userId = await seedBundlePlusMember()
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('cancels the line, writes a subscription_remove MemberAction, disclosure frozen', async () => {
      const disclosure = await computeBreakDisclosure(testPrisma, {
        userId,
        featureId: askBase.featureId,
        changeType: 'cancel',
      })
      expect(disclosure.breaks).toBe(true)
      // score/plus survives at its OWN level (unchanged) — still shown à la carte.
      expect(disclosure.survivorLines.some((l) => l.featureSlug === 'score' && l.tierLevel === 'plus')).toBe(true)

      await testPrisma.$transaction(async (tx) => {
        await breakSubscriptionCore(tx as unknown as Prisma.TransactionClient, {
          userId,
          featureId: askBase.featureId,
          changeType: 'cancel',
          disclosureText: disclosure.disclosureText,
        })
      })

      const askRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: askBase.featureId } })
      expect(askRow.status).toBe('canceled')

      const scoreRow = await testPrisma.subscription.findFirstOrThrow({ where: { userId, featureId: scorePlus.featureId } })
      expect(scoreRow.status).toBe('active') // untouched

      const memberAction = await testPrisma.memberAction.findFirstOrThrow({
        where: { userId, action: 'subscription_remove' },
      })
      expect(memberAction.cartId).toBeNull()
      expect(memberAction.targetId).toBe(askRow.id)
      const consent = memberAction.consent as { disclosureText: string }
      expect(consent.disclosureText).toBe(disclosure.disclosureText)
    })
  })

  describe('a change that does NOT break the bundle (still qualifies, floored — §5)', () => {
    it('captures consent for the change itself with no spurious reprice claim', async () => {
      // A bundle-pro member (score/pro + ask/plus) downgrading score pro -> plus
      // still qualifies bundle-plus (score>=plus, ask>=base — ask/plus floors
      // above the ask/base requirement). qualifyBundle floors, so this is an
      // ordinary in-bundle move, not a break.
      const scorePro = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } })
      const nonBreakingUser = await createDisposableUser()
      try {
        const askPlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'plus' } })
        const periodStart = new Date()
        const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)
        const stripeSubscriptionId = `sub_fake_nobreak_${nonBreakingUser}`

        await testPrisma.subscription.createMany({
          data: [
            {
              userId: nonBreakingUser,
              tierId: scorePro.id,
              featureId: scorePro.featureId,
              status: 'active',
              periodStart,
              periodEnd,
              stripeSubscriptionId,
            },
            {
              userId: nonBreakingUser,
              tierId: askPlus.id,
              featureId: askPlus.featureId,
              status: 'active',
              periodStart,
              periodEnd,
              stripeSubscriptionId,
            },
          ],
        })

        const disclosure = await computeBreakDisclosure(testPrisma, {
          userId: nonBreakingUser,
          featureId: scorePro.featureId,
          changeType: 'downgrade',
          newTierId: scorePlus.id,
        })
        // score/pro -> score/plus with ask/plus still held: bundle-pro (score
        // pro, ask plus) drops to bundle-plus (score plus, ask base) — ask/plus
        // still floors above ask/base, so bundle-plus still qualifies. Not null.
        expect(disclosure.breaks).toBe(false)
        expect(disclosure.survivorLines).toHaveLength(0) // no reprice claim — no survivor lines computed
        expect(disclosure.disclosureText).toContain('does not break your current bundle qualification')

        await testPrisma.$transaction(async (tx) => {
          await breakSubscriptionCore(tx as unknown as Prisma.TransactionClient, {
            userId: nonBreakingUser,
            featureId: scorePro.featureId,
            changeType: 'downgrade',
            newTierId: scorePlus.id,
            disclosureText: disclosure.disclosureText,
          })
        })

        const memberAction = await testPrisma.memberAction.findFirstOrThrow({
          where: { userId: nonBreakingUser, action: 'subscription_downgrade' },
        })
        expect(memberAction.consent).toMatchObject({ disclosureText: disclosure.disclosureText })
      } finally {
        await teardownDisposableUser(nonBreakingUser)
      }
    })
  })

  describe('atomicity: consent and effect commit together or not at all', () => {
    it('a failure after the entitlement write rolls back the whole tx — no orphaned MemberAction', async () => {
      const userId = await seedBundlePlusMember()
      try {
        await expect(
          testPrisma.$transaction(async (tx) => {
            await breakSubscriptionCore(tx as unknown as Prisma.TransactionClient, {
              userId,
              featureId: scorePlus.featureId,
              changeType: 'downgrade',
              newTierId: scoreBase.id,
              disclosureText: 'forced-failure-test',
            })
            throw new Error('forced failure after the entitlement write')
          }),
        ).rejects.toThrow('forced failure')

        // Entitlement write rolled back — score/plus is still active, no
        // score/base row landed.
        const scoreRows = await testPrisma.subscription.findMany({ where: { userId, featureId: scorePlus.featureId } })
        expect(scoreRows).toHaveLength(1)
        expect(scoreRows[0]?.tierId).toBe(scorePlus.id)
        expect(scoreRows[0]?.status).toBe('active')

        // MemberAction rolled back too — never persisted.
        const memberAction = await testPrisma.memberAction.findFirst({ where: { userId, action: 'subscription_downgrade' } })
        expect(memberAction).toBeNull()
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })
})
