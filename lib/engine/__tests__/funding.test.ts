import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fund } from '../funding'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('fund', () => {
  let userId: string

  beforeAll(async () => {
    userId = await createDisposableUser()
    await testPrisma.wallet.create({ data: { userId, balance: -10 } })
  })

  afterAll(async () => {
    await teardownDisposableUser(userId)
  })

  it('fund() clears a negative balance', async () => {
    await fund(testPrisma, userId, 25, 'adjustment')

    const wallet = await testPrisma.wallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(15)

    const row = await testPrisma.ledgerEntry.findFirstOrThrow({
      where: { userId, kind: 'funding' },
    })
    expect(row.creditDelta).toBe(25)
    expect(row.reason).toBe('adjustment')
  })
})
