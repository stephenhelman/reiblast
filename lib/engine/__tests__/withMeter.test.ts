import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MeteredWorkError, withMeter } from '../withMeter'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

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

describe('withMeter', () => {
  let scoreToolId: string
  let scoreFeatureId: string

  beforeAll(async () => {
    const scoreTool = await testPrisma.tool.findUniqueOrThrow({ where: { slug: 'score' } })
    const scoreFeature = await testPrisma.feature.findUniqueOrThrow({ where: { slug: 'score' } })
    scoreToolId = scoreTool.id
    scoreFeatureId = scoreFeature.id
  })

  describe('success: allowance path', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 5 } })
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('precheck -> allowance, chargeOnSuccess fires, wallet untouched, remaining decrements', async () => {
      let workRan = false
      const { result, meter } = await withMeter(testPrisma, userId, 'score', scoreToolId, 5, async () => {
        workRan = true
        return { result: 'analysis-done', vendorCostCents: 13 }
      })

      expect(workRan).toBe(true)
      expect(result).toBe('analysis-done')
      expect(meter).toMatchObject({ outcome: 'charged', decision: 'allowance', creditsDebited: 0, allowanceCovered: true })
      expect(meter.outcome === 'charged' && meter.remaining).toBe(9) // 10 allowance - 1 used
      expect(meter.outcome === 'charged' && meter.balance).toBe(5) // wallet untouched

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(5)

      const row = await testPrisma.ledgerEntry.findFirstOrThrow({
        where: { userId, kind: 'consumption' },
      })
      expect(row.allowanceCovered).toBe(true)
      expect(row.creditsDebited).toBe(0)
      expect(row.vendorCostCents).toBe(13)
    })
  })

  describe('success: credit path', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 20 } })
      await exhaustScoreAllowance(userId, scoreToolId, scoreFeatureId)
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('precheck -> credit, wallet decrements by creditCost, remaining stays 0', async () => {
      const { result, meter } = await withMeter(testPrisma, userId, 'score', scoreToolId, 5, async () => {
        return { result: 'analysis-done', vendorCostCents: 13 }
      })

      expect(result).toBe('analysis-done')
      expect(meter).toMatchObject({ outcome: 'charged', decision: 'credit', creditsDebited: 5, allowanceCovered: false })
      expect(meter.outcome === 'charged' && meter.balance).toBe(15) // 20 - 5
      expect(meter.outcome === 'charged' && meter.remaining).toBe(0)

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(15)
    })
  })

  describe('thrown work', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 5 } })
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('recordFailure fires with the thrown vendorCostCents, no charge, original error rethrown', async () => {
      await expect(
        withMeter(testPrisma, userId, 'score', scoreToolId, 5, async () => {
          throw new MeteredWorkError(7, 'vendor call blew up')
        }),
      ).rejects.toThrow('vendor call blew up')

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(5)

      const row = await testPrisma.ledgerEntry.findFirstOrThrow({
        where: { userId, outcome: 'fail' },
      })
      expect(row.vendorCostCents).toBe(7)
      expect(row.creditDelta).toBe(0)
      expect(row.creditsDebited).toBe(0)
    })

    it('a plain (non-MeteredWorkError) throw logs vendorCostCents 0 and still rethrows', async () => {
      await expect(
        withMeter(testPrisma, userId, 'score', scoreToolId, 5, async () => {
          throw new Error('unexpected crash before any vendor spend')
        }),
      ).rejects.toThrow('unexpected crash before any vendor spend')

      const rows = await testPrisma.ledgerEntry.findMany({
        where: { userId, outcome: 'fail' },
      })
      expect(rows).toHaveLength(2) // the previous test's fail row + this one
      expect(rows[rows.length - 1].vendorCostCents).toBe(0)
    })
  })

  describe('blocked', () => {
    let userId: string

    beforeAll(async () => {
      userId = await createDisposableUser()
      await testPrisma.wallet.create({ data: { userId, balance: 2 } })
      await exhaustScoreAllowance(userId, scoreToolId, scoreFeatureId)
    })

    afterAll(async () => {
      await teardownDisposableUser(userId)
    })

    it('neither work nor any charge fires; nothing moves', async () => {
      let workRan = false
      const { result, meter } = await withMeter(testPrisma, userId, 'score', scoreToolId, 5, async () => {
        workRan = true
        return { result: 'should-not-run', vendorCostCents: 13 }
      })

      expect(workRan).toBe(false)
      expect(result).toBeNull()
      expect(meter).toEqual({ outcome: 'blocked', decision: 'blocked' })

      const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
      expect(wallet.balance).toBe(2)

      const rows = await testPrisma.ledgerEntry.findMany({ where: { userId } })
      expect(rows).toHaveLength(10) // just the exhausted-allowance fixture rows
    })
  })
})
