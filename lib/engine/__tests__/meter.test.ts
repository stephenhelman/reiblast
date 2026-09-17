import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chargeOnSuccess, precheck, recordFailure } from '../meter'
import { openToolUse } from '../toolUse'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

async function openTestToolUse(userId: string): Promise<string> {
  const { id } = await openToolUse(testPrisma, {
    userId,
    locationId: 'test-location',
    isAdmin: false,
    featureSlug: 'score',
    kind: 'SFR',
  })
  return id
}

async function exhaustScoreAllowance(userId: string, scoreToolId: string, scoreFeatureId: string) {
  await testPrisma.ledgerEntry.createMany({
    data: Array.from({ length: 10 }, () => ({
      userId,
      kind: 'consumption' as const,
      creditDelta: 0,
      toolId: scoreToolId,
      featureId: scoreFeatureId,
      unitCount: 1,
      allowanceCovered: true,
      creditsDebited: 0,
      outcome: 'success' as const,
    })),
  })
}

describe('meter', () => {
  let scoreToolId: string
  let scoreFeatureId: string

  beforeAll(async () => {
    const scoreTool = await testPrisma.tool.findUniqueOrThrow({ where: { slug: 'score' } })
    const scoreFeature = await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'score' } })
    scoreToolId = scoreTool.id
    scoreFeatureId = scoreFeature.id
  })

  describe('cascade: exhaust allowance, next unit debits credits', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 5 } })
      await exhaustScoreAllowance(userId, scoreToolId, scoreFeatureId)
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('exhausted allowance falls through to credit and debits creditCost', async () => {
      const decision = await precheck(testPrisma, userId, 'score', 5)
      expect(decision).toBe('credit')

      const toolUseId = await openTestToolUse(userId)
      await chargeOnSuccess(testPrisma, userId, 'score', scoreToolId, 'credit', 5, 200, toolUseId)

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(0)

      const row = await testPrisma.ledgerEntry.findFirstOrThrow({
        where: { userId, allowanceCovered: false, kind: 'consumption' },
      })
      expect(row.creditsDebited).toBe(5)
      expect(row.creditDelta).toBe(-5)
      expect(row.toolUseId).toBe(toolUseId)

      const toolUse = await testPrisma.toolUse.findUniqueOrThrow({ where: { id: toolUseId } })
      expect(toolUse.outcome).toBe('success')
    })
  })

  describe('negative-never-blocks-allowance', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: -3 } })
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('wallet -3 with allowance remaining still resolves to allowance and runs', async () => {
      const decision = await precheck(testPrisma, userId, 'score', 5)
      expect(decision).toBe('allowance')

      const toolUseId = await openTestToolUse(userId)
      await chargeOnSuccess(testPrisma, userId, 'score', scoreToolId, 'allowance', 5, 200, toolUseId)

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(-3)
    })
  })

  describe('strict block', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 2 } })
      await exhaustScoreAllowance(userId, scoreToolId, scoreFeatureId)
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('allowance gone, balance 2, cost 5 → blocked (does not run, no negative)', async () => {
      const decision = await precheck(testPrisma, userId, 'score', 5)
      expect(decision).toBe('blocked')

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(2)
    })
  })

  describe('race-only negative balance', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 10 } })
      await exhaustScoreAllowance(userId, scoreToolId, scoreFeatureId)
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('two concurrent full precheck→charge sequences from balance 10, cost 10 each → both commit, -10', async () => {
      // Force the actual check-then-act gap: both precheck() calls must read
      // balance 10 and both decide 'credit' BEFORE either chargeOnSuccess() fires.
      // Racing the two full precheck→charge sequences directly is not reliable over
      // a real network round trip to Neon — one call's multi-query precheck can
      // finish (and commit) before the other's precheck even starts, hiding the race.
      const decisions = await Promise.all([
        precheck(testPrisma, userId, 'score', 10),
        precheck(testPrisma, userId, 'score', 10),
      ])
      expect(decisions).toEqual(['credit', 'credit'])

      const toolUseIds = await Promise.all(decisions.map(() => openTestToolUse(userId)))

      await Promise.all(
        decisions.map((decision, i) =>
          decision === 'credit'
            ? chargeOnSuccess(testPrisma, userId, 'score', scoreToolId, 'credit', 10, 500, toolUseIds[i])
            : Promise.resolve(),
        ),
      )

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(-10)

      const rows = await testPrisma.ledgerEntry.findMany({
        where: { userId, allowanceCovered: false, kind: 'consumption' },
      })
      expect(rows).toHaveLength(2)
    })
  })

  describe('failure', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 5 } })
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('recordFailure logs vendorCostCents, no wallet change', async () => {
      const toolUseId = await openTestToolUse(userId)
      await recordFailure(testPrisma, userId, 'score', scoreToolId, 300, toolUseId)

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(5)

      const row = await testPrisma.ledgerEntry.findFirstOrThrow({
        where: { userId, outcome: 'fail' },
      })
      expect(row.vendorCostCents).toBe(300)
      expect(row.creditDelta).toBe(0)
      expect(row.creditsDebited).toBe(0)
      expect(row.allowanceCovered).toBe(false)
      expect(row.toolUseId).toBe(toolUseId)

      const toolUse = await testPrisma.toolUse.findUniqueOrThrow({ where: { id: toolUseId } })
      expect(toolUse.outcome).toBe('fail')
    })
  })
})
