import { FundingReason, PrismaClient } from '@prisma/client'

// ONE transaction: atomic wallet increment + a funding LedgerEntry. Same
// atomic-column-update primitive as the credit debit, opposite sign. This is the
// primitive Stripe will call later; the webhook itself is a later chat.
export async function fund(
  prisma: PrismaClient,
  userId: string,
  credits: number,
  reason: FundingReason,
  opts?: { creditPackId?: string; refId?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Wallet" SET balance = balance + ${credits}, "updatedAt" = now() WHERE "userId" = ${userId}`
    await tx.ledgerEntry.create({
      data: {
        userId,
        kind: 'funding',
        creditDelta: credits,
        reason,
        creditPackId: opts?.creditPackId,
        refId: opts?.refId,
      },
    })
  })
}
