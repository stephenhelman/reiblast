import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'

const url = process.env.SEED_DATABASE_URL
if (!url) {
  throw new Error(
    'SEED_DATABASE_URL is not set — refusing to run engine tests against a guessed database (never .env/DATABASE_URL).',
  )
}

export const testPrisma = new PrismaClient({ datasourceUrl: url })

export function disposableEmail(): string {
  return `test+engine-${randomBytes(6).toString('hex')}@wholesaleos.local`
}

export async function createDisposableUser(): Promise<string> {
  const user = await testPrisma.user.create({
    data: { email: disposableEmail(), status: 'active' },
  })
  return user.id
}

// FK order: LedgerEntry -> Subscription -> Wallet -> User. Each delete is guarded
// so a missing/already-cleaned row can't throw and abort the rest of the sweep.
export async function teardownDisposableUser(userId: string): Promise<void> {
  const steps = [
    () => testPrisma.ledgerEntry.deleteMany({ where: { userId } }),
    () => testPrisma.subscription.deleteMany({ where: { userId } }),
    () => testPrisma.wallet.deleteMany({ where: { userId } }),
    () => testPrisma.user.deleteMany({ where: { id: userId } }),
  ]
  for (const step of steps) {
    try {
      await step()
    } catch {
      // best-effort sweep — a stray disposable row is identifiable later by its
      // test+engine- email prefix even if one delete in the chain failed.
    }
  }
}
