import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { landSubscriptionItem } from '../subscriptionLand'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('landSubscriptionItem (core, status-agnostic locate)', () => {
  let userId: string

  beforeAll(async () => {
    userId = await createDisposableUser()
  })

  afterAll(async () => {
    await teardownDisposableUser(userId)
  })

  it('creates a row when the (stripeSubscriptionId, tierId) slot is empty, then RESURRECTS the same row (no duplicate) when called again for a canceled slot', async () => {
    const scoreBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'base' } })
    const stripeSubscriptionId = `sub_fake_core_${userId}`
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)

    await testPrisma.$transaction(async (tx) => {
      await landSubscriptionItem(tx as unknown as Prisma.TransactionClient, {
        userId,
        tierId: scoreBase.id,
        featureId: scoreBase.featureId,
        status: 'active',
        periodStart,
        periodEnd,
        stripeSubscriptionId,
      })
    })

    const firstRow = await testPrisma.subscription.findFirstOrThrow({
      where: { stripeSubscriptionId, tierId: scoreBase.id },
    })
    expect(firstRow.status).toBe('active')

    // Cancel it directly (simulating an orphan-cancel from a caller), then
    // land the SAME slot again — the locate is status-agnostic, so this must
    // RESURRECT firstRow by id, not create a second row.
    await testPrisma.subscription.update({ where: { id: firstRow.id }, data: { status: 'canceled' } })

    await testPrisma.$transaction(async (tx) => {
      await landSubscriptionItem(tx as unknown as Prisma.TransactionClient, {
        userId,
        tierId: scoreBase.id,
        featureId: scoreBase.featureId,
        status: 'active',
        periodStart,
        periodEnd,
        stripeSubscriptionId,
      })
    })

    const rows = await testPrisma.subscription.findMany({
      where: { stripeSubscriptionId, tierId: scoreBase.id },
    })
    expect(rows).toHaveLength(1) // resurrected, not duplicated
    expect(rows[0]?.id).toBe(firstRow.id)
    expect(rows[0]?.status).toBe('active')
  })
})
