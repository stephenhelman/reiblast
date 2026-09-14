import { FundingReason, Prisma, PrismaClient } from '@prisma/client'

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient

// The two statements below, run once. Factored out so the PrismaClient path
// (below) can wrap it in its own $transaction while a caller that's already
// inside a transaction (e.g. the Stripe webhook) can run it directly on its
// tx client — Prisma's interactive transaction clients don't support nesting
// another $transaction inside them.
async function fundEffect(
  client: PrismaClientOrTx,
  userId: string,
  credits: number,
  reason: FundingReason,
  opts?: { creditPackId?: string; refId?: string },
): Promise<void> {
  await client.$executeRaw`UPDATE "Wallet" SET balance = balance + ${credits}, "updatedAt" = now() WHERE "userId" = ${userId}`
  await client.ledgerEntry.create({
    data: {
      userId,
      kind: 'funding',
      creditDelta: credits,
      reason,
      creditPackId: opts?.creditPackId,
      refId: opts?.refId,
    },
  })
}

// Atomic wallet increment + a funding LedgerEntry. Same atomic-column-update
// primitive as the credit debit, opposite sign.
//
// Accepts either a top-level PrismaClient (opens its own $transaction — the
// existing/test call shape) or an existing Prisma.TransactionClient (runs
// directly on it — the Stripe webhook's shape, where fund() must join the
// caller's already-open transaction rather than nest a new one).
export async function fund(
  prisma: PrismaClientOrTx,
  userId: string,
  credits: number,
  reason: FundingReason,
  opts?: { creditPackId?: string; refId?: string },
): Promise<void> {
  if ('$transaction' in prisma) {
    await prisma.$transaction((tx) => fundEffect(tx, userId, credits, reason, opts))
  } else {
    await fundEffect(prisma, userId, credits, reason, opts)
  }
}
