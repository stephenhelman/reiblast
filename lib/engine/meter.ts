import { PrismaClient } from '@prisma/client'
import { resolveFeature } from './resolver'

export type MeterDecision = 'allowance' | 'credit' | 'blocked'

// Phase A — pre-check gate. Pure read (via resolveFeature); no reservation, no write.
// remaining > 0 wins outright — the wallet is never consulted, even if balance is
// negative. Otherwise the full creditCost must be covered (strict; no overshoot).
export async function precheck(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
  creditCost: number,
): Promise<MeterDecision> {
  const resolved = await resolveFeature(prisma, userId, featureSlug)
  if (resolved.remaining === null || resolved.remaining > 0) return 'allowance'
  if (resolved.balance >= creditCost) return 'credit'
  return 'blocked'
}

// Phase C — charge on success, ONE transaction. The write is the gate.
export async function chargeOnSuccess(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
  toolId: string,
  decision: 'allowance' | 'credit',
  creditCost: number,
  vendorCostCents: number,
): Promise<void> {
  const feature = await prisma.feature.findUniqueOrThrow({ where: { slug: featureSlug } })

  await prisma.$transaction(async (tx) => {
    if (decision === 'allowance') {
      // Plain insert — no in-tx recount, no fallthrough to credits. A race that
      // overfills the last slot is absorbed as free allowance (never touches the wallet).
      await tx.ledgerEntry.create({
        data: {
          userId,
          kind: 'consumption',
          creditDelta: 0,
          toolId,
          featureId: feature.id,
          unitCount: 1,
          vendorCostCents,
          creditsDebited: 0,
          allowanceCovered: true,
          outcome: 'success',
        },
      })
    } else {
      // Single-statement atomic decrement — NEVER read-then-write. Race-safe by
      // construction; a concurrent pair can both pass precheck and both commit here,
      // which is the accepted, self-healing negative-balance race.
      await tx.$executeRaw`UPDATE "Wallet" SET balance = balance - ${creditCost}, "updatedAt" = now() WHERE "userId" = ${userId}`
      await tx.ledgerEntry.create({
        data: {
          userId,
          kind: 'consumption',
          creditDelta: -creditCost,
          toolId,
          featureId: feature.id,
          unitCount: 1,
          vendorCostCents,
          creditsDebited: creditCost,
          allowanceCovered: false,
          outcome: 'success',
        },
      })
    }
  })
}

// Phase B (fail branch) — log true vendor cost, no wallet change, member pays nothing.
export async function recordFailure(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
  toolId: string,
  vendorCostCents: number,
): Promise<void> {
  const feature = await prisma.feature.findUniqueOrThrow({ where: { slug: featureSlug } })

  await prisma.ledgerEntry.create({
    data: {
      userId,
      kind: 'consumption',
      creditDelta: 0,
      toolId,
      featureId: feature.id,
      unitCount: 1,
      vendorCostCents,
      creditsDebited: 0,
      allowanceCovered: false,
      outcome: 'fail',
    },
  })
}
