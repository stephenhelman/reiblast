import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFeature } from '../resolver'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('resolveFeature', () => {
  let userId: string

  beforeAll(async () => {
    userId = await createDisposableUser()
  })

  afterAll(async () => {
    await teardownDisposableUser(userId)
  })

  it('base-tier member: 10 score allowance, calendar-month window, resolver math', async () => {
    const resolved = await resolveFeature(testPrisma, userId, 'score')

    expect(resolved.level).toBe('base')
    expect(resolved.allowance).toBe(10)
    expect(resolved.used).toBe(0)
    expect(resolved.remaining).toBe(10)
    expect(resolved.balance).toBe(0)

    const now = new Date()
    expect(resolved.periodStart.getUTCFullYear()).toBe(now.getUTCFullYear())
    expect(resolved.periodStart.getUTCMonth()).toBe(now.getUTCMonth())
    expect(resolved.periodStart.getUTCDate()).toBe(1)
    expect(resolved.periodEnd.getTime()).toBeGreaterThan(resolved.periodStart.getTime())
  })

  it('highest-wins: solo Score Plus + bundle-pro both active → pro', async () => {
    const scorePlusTier = await testPrisma.tier.findUniqueOrThrow({
      where: { featureId_level: { featureId: (await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'score' } })).id, level: 'plus' } },
    })
    const bundlePro = await testPrisma.bundle.findUniqueOrThrow({ where: { slug: 'bundle-pro' } })

    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)

    await testPrisma.subscription.createMany({
      data: [
        {
          userId,
          type: 'tool_sub',
          tierId: scorePlusTier.id,
          status: 'active',
          periodStart,
          periodEnd,
        },
        {
          userId,
          type: 'bundle',
          bundleId: bundlePro.id,
          status: 'active',
          periodStart,
          periodEnd,
        },
      ],
    })

    const resolved = await resolveFeature(testPrisma, userId, 'score')
    expect(resolved.level).toBe('pro')
    expect(resolved.allowance).toBe(175)
  })

  it('bots shared pool: consumption under acq + dispo both count against the one bots feature used', async () => {
    const bots = await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'bots' } })
    const acq = await testPrisma.tool.findUniqueOrThrow({ where: { slug: 'acq' } })
    const dispo = await testPrisma.tool.findUniqueOrThrow({ where: { slug: 'dispo' } })

    await testPrisma.ledgerEntry.createMany({
      data: [
        {
          userId,
          kind: 'consumption',
          creditDelta: 0,
          toolId: acq.id,
          featureId: bots.id,
          unitCount: 1,
          allowanceCovered: true,
          creditsDebited: 0,
          outcome: 'success',
        },
        {
          userId,
          kind: 'consumption',
          creditDelta: 0,
          toolId: dispo.id,
          featureId: bots.id,
          unitCount: 1,
          allowanceCovered: true,
          creditsDebited: 0,
          outcome: 'success',
        },
      ],
    })

    const resolved = await resolveFeature(testPrisma, userId, 'bots')
    expect(resolved.used).toBe(2)
    expect(resolved.allowance).toBe(60)
    expect(resolved.remaining).toBe(58)
  })
})
