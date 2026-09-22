import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma, PrismaClient } from '@prisma/client'
import { upsertMemberCartCore, overrideMemberCartCore } from '../memberCart'
import { computeCheckoutDisclosure, writeCheckoutConsentCore, commitCheckoutConsent } from '../checkoutConsent'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('checkoutConsent (Phase 5b — consent-before-checkout, the final consent carrier)', () => {
  let adminUserId: string
  let askBase: { id: string; featureId: string }
  let pack250: { id: string; credits: number; priceCents: number }

  beforeAll(async () => {
    adminUserId = await createDisposableUser()
    askBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } })
    pack250 = await testPrisma.creditPack.findFirstOrThrow({ where: { slug: 'pack-250' } })
  })

  afterAll(async () => {
    await teardownDisposableUser(adminUserId)
  })

  describe('computeCheckoutDisclosure — additive paths, priceCents straight off the row', () => {
    it('a fresh subscription cart shows the tier à-la-carte priceCents, no from-price needed', async () => {
      const userId = await createDisposableUser()
      try {
        const cartResult = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in cartResult) || !cartResult.cartId) throw new Error('expected ok result')

        const disclosure = await computeCheckoutDisclosure(testPrisma, { cartId: cartResult.cartId })
        const askBaseTier = await testPrisma.tier.findUniqueOrThrow({ where: { id: askBase.id } })

        expect(disclosure.type).toBe('subscription_add')
        expect(disclosure.mode).toBe('subscription')
        expect(disclosure.lines).toHaveLength(1)
        expect(disclosure.lines[0]?.priceCents).toBe(askBaseTier.priceCents) // straight off the Tier row, no Stripe round-trip
        expect(disclosure.totalCents).toBe(askBaseTier.priceCents)
        expect(disclosure.disclosureText).toContain(`$${(disclosure.totalCents / 100).toFixed(2)}`)
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('a credit-pack cart shows the pack price', async () => {
      const userId = await createDisposableUser()
      try {
        const cartResult = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'credit_pack',
            lines: [{ creditPackId: pack250.id }],
          }),
        )
        if (!('ok' in cartResult) || !cartResult.cartId) throw new Error('expected ok result')

        const disclosure = await computeCheckoutDisclosure(testPrisma, { cartId: cartResult.cartId })
        expect(disclosure.type).toBe('credit_pack_purchase')
        expect(disclosure.mode).toBe('credit_pack')
        expect(disclosure.lines).toEqual([{ kind: 'credit_pack', label: `${pack250.credits} credits`, priceCents: pack250.priceCents }])
        expect(disclosure.totalCents).toBe(pack250.priceCents)
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('PATH 1 — member-self checkout', () => {
    it('approve writes ONE MemberAction (targetType Cart, cartId set, type subscription_add), disclosureText carries the priceCents shown, NO entitlement row', async () => {
      const userId = await createDisposableUser()
      try {
        const cartResult = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in cartResult) || !cartResult.cartId) throw new Error('expected ok result')
        const cartId = cartResult.cartId

        const disclosure = await computeCheckoutDisclosure(testPrisma, { cartId })

        await testPrisma.$transaction((tx) =>
          writeCheckoutConsentCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            cartId,
            disclosureText: disclosure.disclosureText,
            type: disclosure.type,
          }),
        )

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(1)
        const memberAction = memberActions[0]!
        expect(memberAction.targetType).toBe('Cart')
        expect(memberAction.targetId).toBe(cartId)
        expect(memberAction.cartId).toBe(cartId)
        expect(memberAction.action).toBe('subscription_add')
        const consent = memberAction.consent as { disclosureText: string; type: string }
        expect(consent.disclosureText).toBe(disclosure.disclosureText)
        expect(consent.disclosureText).toContain(`$${(disclosure.totalCents / 100).toFixed(2)}`)
        expect(consent.type).toBe('subscription_add')

        const subs = await testPrisma.subscription.findMany({ where: { userId } })
        expect(subs).toHaveLength(0) // no entitlement execution — that's the deferred Stripe effect
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('credit-pack checkout writes type credit_pack_purchase', async () => {
      const userId = await createDisposableUser()
      try {
        const cartResult = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'credit_pack',
            lines: [{ creditPackId: pack250.id }],
          }),
        )
        if (!('ok' in cartResult) || !cartResult.cartId) throw new Error('expected ok result')
        const cartId = cartResult.cartId

        const disclosure = await computeCheckoutDisclosure(testPrisma, { cartId })
        await testPrisma.$transaction((tx) =>
          writeCheckoutConsentCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            cartId,
            disclosureText: disclosure.disclosureText,
            type: disclosure.type,
          }),
        )

        const memberAction = await testPrisma.memberAction.findFirstOrThrow({ where: { userId } })
        expect(memberAction.action).toBe('credit_pack_purchase')
        expect(memberAction.targetType).toBe('Cart')
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('PATH 2 — admin-staged finalize (completing IS consent by construction)', () => {
    it('approve writes ONE MemberAction targetType Cart on the STAGED cart', async () => {
      const userId = await createDisposableUser()
      try {
        const memberCart = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in memberCart) || !memberCart.cartId) throw new Error('expected ok result')

        const askPlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'plus' } })
        const override = await testPrisma.$transaction((tx) =>
          overrideMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId: userId,
            mode: 'subscription',
            proposalTierIds: [askPlus.id],
          }),
        )

        const disclosure = await computeCheckoutDisclosure(testPrisma, { cartId: override.cartId })
        expect(disclosure.lines[0]?.priceCents).toBeGreaterThan(0)

        await testPrisma.$transaction((tx) =>
          writeCheckoutConsentCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            cartId: override.cartId,
            disclosureText: disclosure.disclosureText,
            type: disclosure.type,
          }),
        )

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(1)
        expect(memberActions[0]?.targetType).toBe('Cart')
        expect(memberActions[0]?.targetId).toBe(override.cartId)
        expect(memberActions[0]?.cartId).toBe(override.cartId)
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('ORDERING — consent commits before mint is invoked', () => {
    it('the spy mint callback observes the MemberAction already committed', async () => {
      const userId = await createDisposableUser()
      try {
        const cartResult = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in cartResult) || !cartResult.cartId) throw new Error('expected ok result')
        const cartId = cartResult.cartId

        const disclosure = await computeCheckoutDisclosure(testPrisma, { cartId })

        let observedAtMintTime: number | null = null
        let mintCalled = false
        await commitCheckoutConsent(
          testPrisma as unknown as PrismaClient,
          { userId, cartId, disclosureText: disclosure.disclosureText, type: disclosure.type },
          async () => {
            mintCalled = true
            const rows = await testPrisma.memberAction.findMany({ where: { userId, targetType: 'Cart', targetId: cartId } })
            observedAtMintTime = rows.length
          },
        )

        expect(mintCalled).toBe(true)
        expect(observedAtMintTime).toBe(1) // consent already committed by the time mint ran
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('abandon — preview without approve writes nothing', () => {
    it('computing the disclosure alone (no commit) leaves NO MemberAction', async () => {
      const userId = await createDisposableUser()
      try {
        const cartResult = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in cartResult) || !cartResult.cartId) throw new Error('expected ok result')

        await computeCheckoutDisclosure(testPrisma, { cartId: cartResult.cartId }) // preview only — modal-open is not the consent event

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })
})
