import { Prisma, PrismaClient, ToolOutcome } from '@prisma/client'
import type { ToolUseDetail } from '@/lib/toolUseDetail'

type DbClient = PrismaClient | Prisma.TransactionClient

// Write ToolUse at RUN START, not completion. outcome defaults to 'fail' — the
// crash-safe default: if the process dies before finalizeToolUse runs, the row
// reads as a failed run (with whatever ApiCall children got written) rather
// than silently vanishing or misreading as success. finalizeToolUse overwrites
// it with the real outcome once the run settles.
export async function openToolUse(
  prisma: DbClient,
  params: {
    userId: string
    locationId: string
    isAdmin: boolean
    featureSlug: string
    kind: string
  },
): Promise<{ id: string }> {
  const toolUse = await prisma.toolUse.create({
    data: {
      userId: params.userId,
      locationId: params.locationId,
      isAdmin: params.isAdmin,
      featureSlug: params.featureSlug,
      kind: params.kind,
      outcome: ToolOutcome.fail,
    },
  })
  return { id: toolUse.id }
}

// Finalize the run's outcome and behavioral facts. Called inside the same
// transactional-or-reconciled write as its ApiCall children / LedgerEntry, per
// the correlation loop (1 ToolUse -> N ApiCall -> (if metered) 1 LedgerEntry).
export async function finalizeToolUse(
  prisma: DbClient,
  toolUseId: string,
  params: {
    outcome: ToolOutcome
    compSource?: string | null
    propertyDataSource?: string | null
    detail?: ToolUseDetail | null
  },
): Promise<void> {
  await prisma.toolUse.update({
    where: { id: toolUseId },
    data: {
      outcome: params.outcome,
      compSource: params.compSource,
      propertyDataSource: params.propertyDataSource,
      ...(params.detail !== undefined ? { detail: params.detail ?? Prisma.JsonNull } : {}),
    },
  })
}
