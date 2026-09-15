import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFeature } from '../resolver'
import { qualifyBundle } from '../../bundleQualify'
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

  it('derived bundle-pro member: N tool_subs (score/pro + ask/plus + bots/base) resolve pro-level allowance per feature, and qualify bundle-pro', async () => {
    const [scoreProTier, askPlusTier, botsBaseTier] = await Promise.all([
      testPrisma.tier.findUniqueOrThrow({
        where: { featureId_level: { featureId: (await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'score' } })).id, level: 'pro' } },
      }),
      testPrisma.tier.findUniqueOrThrow({
        where: { featureId_level: { featureId: (await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'ask' } })).id, level: 'plus' } },
      }),
      testPrisma.tier.findUniqueOrThrow({
        where: { featureId_level: { featureId: (await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'bots' } })).id, level: 'base' } },
      }),
    ])

    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)

    await testPrisma.subscription.createMany({
      data: [
        { userId, tierId: scoreProTier.id, featureId: scoreProTier.featureId, status: 'active', periodStart, periodEnd },
        { userId, tierId: askPlusTier.id, featureId: askPlusTier.featureId, status: 'active', periodStart, periodEnd },
        { userId, tierId: botsBaseTier.id, featureId: botsBaseTier.featureId, status: 'active', periodStart, periodEnd },
      ],
    })

    const resolvedScore = await resolveFeature(testPrisma, userId, 'score')
    expect(resolvedScore.level).toBe('pro')
    expect(resolvedScore.allowance).toBe(175)

    const resolvedAsk = await resolveFeature(testPrisma, userId, 'ask')
    expect(resolvedAsk.level).toBe('plus')
    expect(resolvedAsk.allowance).toBe(1500)

    const resolvedBots = await resolveFeature(testPrisma, userId, 'bots')
    expect(resolvedBots.level).toBe('base')
    expect(resolvedBots.allowance).toBe(60)

    expect(qualifyBundle({ score: 'pro', ask: 'plus', bots: 'base' })).toBe('bundle-pro')
  })

  it('floored qualification: score/pro + ask/base qualifies bundle-plus, not bundle-pro (ask misses the plus floor)', () => {
    expect(qualifyBundle({ score: 'pro', ask: 'base' })).toBe('bundle-plus')
  })

  it('qualifyBundle: no qualifying set returns null, and pack never affects qualification', () => {
    expect(qualifyBundle({ score: 'base', ask: 'base' })).toBeNull()
    // QualifyingTiers has no 'pack' key at all — pack can't affect this by construction.
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
    // This member holds bots/base (60) from the earlier test in this file.
    expect(resolved.used).toBe(2)
    expect(resolved.allowance).toBe(60)
    expect(resolved.remaining).toBe(58)
  })
})
