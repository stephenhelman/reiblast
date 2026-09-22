import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { upsertMemberCartCore, overrideMemberCartCore, declineStagedCartCore } from '../memberCart'
import { stageSubscriptionAddCore } from '../adminProposals'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('memberCart (5a — Direction 1 live cart + Direction 2 admin override)', () => {
  let adminUserId: string
  let askBase: { id: string; featureId: string }
  let scorePlus: { id: string; featureId: string }

  beforeAll(async () => {
    adminUserId = await createDisposableUser()
    askBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } })
    scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
  })

  afterAll(async () => {
    await teardownDisposableUser(adminUserId)
  })

  describe('upsertMemberCartCore — live write-through', () => {
    it('add: writes an open member_self cart + lines; NO MemberAction', async () => {
      const userId = await createDisposableUser()
      try {
        const result = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in result) || !result.cartId) throw new Error('expected ok result with a cartId')

        const cart = await testPrisma.cart.findUniqueOrThrow({ where: { id: result.cartId } })
        expect(cart.source).toBe('member_self')
        expect(cart.mode).toBe('subscription')
        expect(cart.status).toBe('open')

        const lines = await testPrisma.cartLine.findMany({ where: { cartId: cart.id } })
        expect(lines).toHaveLength(1)
        expect(lines[0]?.tierId).toBe(askBase.id)

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('update: the SAME cart is updated, not duplicated — one open cart per (userId,mode) throughout', async () => {
      const userId = await createDisposableUser()
      try {
        const first = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in first) || !first.cartId) throw new Error('expected ok result')

        const second = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: scorePlus.id }],
          }),
        )
        if (!('ok' in second) || !second.cartId) throw new Error('expected ok result')

        expect(second.cartId).toBe(first.cartId) // same row, not a new one

        const openCarts = await testPrisma.cart.findMany({ where: { userId, mode: 'subscription', status: 'open' } })
        expect(openCarts).toHaveLength(1)

        const lines = await testPrisma.cartLine.findMany({ where: { cartId: first.cartId } })
        expect(lines).toHaveLength(1)
        expect(lines[0]?.tierId).toBe(scorePlus.id) // replaced, not appended
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('empty lines expires the existing member_self cart', async () => {
      const userId = await createDisposableUser()
      try {
        const first = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: askBase.id }],
          }),
        )
        if (!('ok' in first) || !first.cartId) throw new Error('expected ok result')

        await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, { userId, mode: 'subscription', lines: [] }),
        )

        const cart = await testPrisma.cart.findUniqueOrThrow({ where: { id: first.cartId } })
        expect(cart.status).toBe('expired')
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('rejects a CartLine with neither or both catalog refs', async () => {
      const userId = await createDisposableUser()
      try {
        await expect(
          testPrisma.$transaction((tx) =>
            upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, { userId, mode: 'subscription', lines: [{}] }),
          ),
        ).rejects.toThrow('exactly one catalog ref')
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('Direction 1 — member add while an admin_staged cart is already open', () => {
    it('upsertMemberCartCore returns blocked; NO member_self cart is written', async () => {
      const userId = await createDisposableUser()
      try {
        const staged = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId: userId,
            featureId: askBase.featureId,
            tierId: askBase.id,
          }),
        )
        if (!('ok' in staged)) throw new Error('expected ok result')

        const result = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: scorePlus.id }],
          }),
        )
        expect(result).toMatchObject({ blocked: 'admin_proposal_pending', cartId: staged.cartId })

        const memberSelfCarts = await testPrisma.cart.findMany({ where: { userId, source: 'member_self' } })
        expect(memberSelfCarts).toHaveLength(0)

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('deny (decline) expires the admin_staged cart, then the member add succeeds', async () => {
      const userId = await createDisposableUser()
      try {
        const staged = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId: userId,
            featureId: askBase.featureId,
            tierId: askBase.id,
          }),
        )
        if (!('ok' in staged)) throw new Error('expected ok result')

        await testPrisma.$transaction((tx) =>
          declineStagedCartCore(tx as unknown as Prisma.TransactionClient, { userId, cartId: staged.cartId }),
        )

        const stagedCart = await testPrisma.cart.findUniqueOrThrow({ where: { id: staged.cartId } })
        expect(stagedCart.status).toBe('expired')

        const result = await testPrisma.$transaction((tx) =>
          upsertMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            userId,
            mode: 'subscription',
            lines: [{ tierId: scorePlus.id }],
          }),
        )
        if (!('ok' in result) || !result.cartId) throw new Error('expected ok result after decline')

        const cart = await testPrisma.cart.findUniqueOrThrow({ where: { id: result.cartId } })
        expect(cart.source).toBe('member_self')
        expect(cart.status).toBe('open')

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('Direction 2 — admin stage while a member_self cart is already open', () => {
    it('stageSubscriptionAddCore returns requiresOverrideConfirm; nothing written', async () => {
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

        const result = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId: userId,
            featureId: scorePlus.featureId,
            tierId: scorePlus.id,
          }),
        )
        expect(result).toMatchObject({ requiresOverrideConfirm: true, memberCartId: memberCart.cartId })

        // Nothing written: still exactly the member's original open cart, no AdminAction for this attempt.
        const openCarts = await testPrisma.cart.findMany({ where: { userId, mode: 'subscription', status: 'open' } })
        expect(openCarts).toHaveLength(1)
        expect(openCarts[0]?.id).toBe(memberCart.cartId)

        const adminActions = await testPrisma.adminAction.findMany({ where: { adminUserId, targetId: userId } })
        expect(adminActions).toHaveLength(0)

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('confirmed override: member cart expired, admin_staged cart written, cart_override AdminAction with correct before/after, one tx, NO MemberAction', async () => {
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

        const result = await testPrisma.$transaction((tx) =>
          overrideMemberCartCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId: userId,
            mode: 'subscription',
            proposalTierIds: [scorePlus.id],
          }),
        )

        const oldCart = await testPrisma.cart.findUniqueOrThrow({ where: { id: memberCart.cartId } })
        expect(oldCart.status).toBe('expired')

        const newCart = await testPrisma.cart.findUniqueOrThrow({ where: { id: result.cartId } })
        expect(newCart.source).toBe('admin_staged')
        expect(newCart.status).toBe('open')
        expect(newCart.adminActionId).toBe(result.adminActionId)

        const newLines = await testPrisma.cartLine.findMany({ where: { cartId: newCart.id } })
        expect(newLines).toHaveLength(1)
        expect(newLines[0]?.tierId).toBe(scorePlus.id)

        const adminAction = await testPrisma.adminAction.findUniqueOrThrow({ where: { id: result.adminActionId } })
        expect(adminAction.action).toBe('cart_override')
        expect(adminAction.targetType).toBe('user')
        expect(adminAction.targetId).toBe(userId)
        expect(adminAction.before).toEqual([{ featureId: askBase.featureId, tierId: askBase.id, status: 'discarded' }])
        expect(adminAction.after).toEqual([{ featureId: scorePlus.featureId, tierId: scorePlus.id, status: 'staged' }])
        expect(adminAction.note).toBeTruthy()

        // Only one open cart for the slot throughout.
        const openCarts = await testPrisma.cart.findMany({ where: { userId, mode: 'subscription', status: 'open' } })
        expect(openCarts).toHaveLength(1)
        expect(openCarts[0]?.id).toBe(newCart.id)

        const memberActions = await testPrisma.memberAction.findMany({ where: { userId } })
        expect(memberActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })

    it('declined: admin never calls overrideMemberCartCore — nothing written, member cart still open', async () => {
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

        const result = await testPrisma.$transaction((tx) =>
          stageSubscriptionAddCore(tx as unknown as Prisma.TransactionClient, {
            adminUserId,
            memberUserId: userId,
            featureId: scorePlus.featureId,
            tierId: scorePlus.id,
          }),
        )
        expect('requiresOverrideConfirm' in result).toBe(true)
        // Admin declines the prompt — simply never calls overrideMemberCartCore.

        const cart = await testPrisma.cart.findUniqueOrThrow({ where: { id: memberCart.cartId } })
        expect(cart.status).toBe('open')
        expect(cart.source).toBe('member_self')

        const adminActions = await testPrisma.adminAction.findMany({ where: { adminUserId, targetId: userId } })
        expect(adminActions).toHaveLength(0)
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })

  describe('P2002 backstop — the partial-unique index guards the invariant even if app logic fails to route', () => {
    it('forcing two open carts for the same (userId,mode) throws P2002', async () => {
      const userId = await createDisposableUser()
      try {
        await testPrisma.cart.create({ data: { userId, mode: 'subscription', status: 'open', source: 'member_self' } })

        await expect(
          testPrisma.cart.create({ data: { userId, mode: 'subscription', status: 'open', source: 'admin_staged' } }),
        ).rejects.toMatchObject({ code: 'P2002' })
      } finally {
        await teardownDisposableUser(userId)
      }
    })
  })
})
