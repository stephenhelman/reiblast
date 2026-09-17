import { PrismaClient } from '@prisma/client'
import { resolveFeature } from './resolver'
import { finalizeToolUse } from './toolUse'
import type { ToolUseDetail } from '@/lib/toolUseDetail'

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

// Phase C — charge on success, ONE transaction. The write is the gate. toolUseId
// links the LedgerEntry to its parent run and finalizes that run's ToolUse row in
// the same transaction — "query ToolUse for usage" and "query ledger for money"
// settle together, never in two separate writes.
export async function chargeOnSuccess(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
  toolId: string,
  decision: 'allowance' | 'credit',
  creditCost: number,
  vendorCostCents: number,
  toolUseId: string,
  toolUseFinalize?: {
    compSource?: string | null
    propertyDataSource?: string | null
    detail?: ToolUseDetail | null
  },
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
          toolUseId,
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
          toolUseId,
        },
      })
    }
    await finalizeToolUse(tx, toolUseId, {
      outcome: 'success',
      compSource: toolUseFinalize?.compSource,
      propertyDataSource: toolUseFinalize?.propertyDataSource,
      detail: toolUseFinalize?.detail,
    })
  })
}

// Phase B (fail branch) — log true vendor cost, no wallet change, member pays
// nothing. toolUseId links the fail-row to its run and finalizes that ToolUse as
// 'fail' in the same transaction, so a failed run still leaves its real
// ApiCall/cost children queryable, not an orphaned ToolUse.
export async function recordFailure(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
  toolId: string,
  vendorCostCents: number,
  toolUseId: string,
): Promise<void> {
  const feature = await prisma.feature.findUniqueOrThrow({ where: { slug: featureSlug } })

  await prisma.$transaction(async (tx) => {
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
        allowanceCovered: false,
        outcome: 'fail',
        toolUseId,
      },
    })
    await finalizeToolUse(tx, toolUseId, { outcome: 'fail' })
  })
}
