import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveUserIdFromToken, signToolsSession } from '@/lib/toolsSession'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

describe('resolveUserIdFromToken (session -> real member bridge)', () => {
  let userId: string

  beforeAll(async () => {
    userId = await createDisposableUser()
  })

  afterAll(async () => {
    await teardownDisposableUser(userId)
  })

  it('resolves a verified session to the real User.id', async () => {
    const token = await signToolsSession({ userId, locationId: 'loc_test' })
    const resolved = await resolveUserIdFromToken(testPrisma, token)
    expect(resolved).toBe(userId)
  })

  it('returns null for a missing token', async () => {
    const resolved = await resolveUserIdFromToken(testPrisma, undefined)
    expect(resolved).toBeNull()
  })

  it('returns null for a garbage token', async () => {
    const resolved = await resolveUserIdFromToken(testPrisma, 'not-a-real-token')
    expect(resolved).toBeNull()
  })

  it('fails closed when the token names a user that no longer exists', async () => {
    const token = await signToolsSession({ userId: 'does-not-exist', locationId: 'loc_test' })
    const resolved = await resolveUserIdFromToken(testPrisma, token)
    expect(resolved).toBeNull()
  })
})
