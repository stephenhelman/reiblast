import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { compFreeMonth } from '../comp'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('compFreeMonth (admin-direct comp, no Stripe, no member consent)', () => {
  let adminUserId: string
  let memberUserId: string

  beforeAll(async () => {
    adminUserId = await createDisposableUser()
    memberUserId = await createDisposableUser()
  })

  afterAll(async () => {
    await teardownDisposableUser(adminUserId)
    await teardownDisposableUser(memberUserId)
  })

  it('comps a feature the member does NOT hold: row landed, AdminAction.after == the new line, one tx', async () => {
    const askBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } })
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)

    await testPrisma.$transaction(async (tx) => {
      await compFreeMonth(tx as unknown as Prisma.TransactionClient, {
        adminUserId,
        userId: memberUserId,
        tierId: askBase.id,
        featureId: askBase.featureId,
        periodStart,
        periodEnd,
        note: 'test comp',
      })
    })

    const row = await testPrisma.subscription.findFirstOrThrow({
      where: { userId: memberUserId, featureId: askBase.featureId },
    })
    expect(row.status).toBe('active')
    expect(row.tierId).toBe(askBase.id)
    expect(row.stripeSubscriptionId).toBeNull()

    const action = await testPrisma.adminAction.findFirstOrThrow({
      where: { adminUserId, action: 'subscription_comp', targetId: memberUserId },
      orderBy: { createdAt: 'desc' },
    })
    expect(action.before).toEqual([])
    expect(action.after).toEqual([{ featureId: askBase.featureId, tierId: askBase.id, status: 'active' }])
  })

  it('comps a feature the member ALREADY holds at another tier: old row canceled via the {userId,featureId} helper, comped tier active, exactly one active row (replace-not-stack), no P2002', async () => {
    const scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
    const scorePro = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } })
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)

    // Member already holds score/plus (e.g. from an existing paid sub).
    await testPrisma.subscription.create({
      data: {
        userId: memberUserId,
        tierId: scorePlus.id,
        featureId: scorePlus.featureId,
        status: 'active',
        periodStart,
        periodEnd,
      },
    })

    await expect(
      testPrisma.$transaction(async (tx) => {
        await compFreeMonth(tx as unknown as Prisma.TransactionClient, {
          adminUserId,
          userId: memberUserId,
          tierId: scorePro.id,
          featureId: scorePro.featureId,
          periodStart,
          periodEnd,
          note: 'upgrade comp',
        })
      }),
    ).resolves.not.toThrow()

    const rows = await testPrisma.subscription.findMany({
      where: { userId: memberUserId, featureId: scorePlus.featureId },
    })
    const activeRows = rows.filter((r) => r.status === 'active')
    expect(activeRows).toHaveLength(1) // replace-not-stack
    expect(activeRows[0]?.tierId).toBe(scorePro.id)

    const plusRow = rows.find((r) => r.tierId === scorePlus.id)
    expect(plusRow?.status).toBe('canceled')

    const action = await testPrisma.adminAction.findFirstOrThrow({
      where: { adminUserId, action: 'subscription_comp', targetId: memberUserId, note: 'upgrade comp' },
    })
    expect(action.before).toEqual([{ featureId: scorePlus.featureId, tierId: scorePlus.id, status: 'active' }])
    expect(action.after).toEqual(
      expect.arrayContaining([{ featureId: scorePro.featureId, tierId: scorePro.id, status: 'active' }]),
    )
  })
})
