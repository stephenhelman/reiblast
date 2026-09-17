import { PrismaClient, Role } from '@prisma/client'
import { chargeOnSuccess, precheck, recordFailure } from './meter'
import { resolveFeature } from './resolver'
import { openToolUse, finalizeToolUse } from './toolUse'
import type { ToolUseDetail } from '@/lib/toolUseDetail'

// The typed failure signal `work` throws to report vendor cost on a failed
// run. `withMeter` RECEIVES vendorCostCents — it never produces it (that's
// the analyzer-instrumentation work, done where the vendor calls live).
// Defaults to 0 for a throw that predates any vendor spend.
export class MeteredWorkError extends Error {
  vendorCostCents: number

  constructor(vendorCostCents = 0, message?: string, options?: ErrorOptions) {
    super(message ?? 'Metered work failed', options)
    this.name = 'MeteredWorkError'
    this.vendorCostCents = vendorCostCents
  }
}

// work receives the toolUseId (opened before work runs) so it can stamp its
// ApiCall children with the parent run — it still only ever RECEIVES/reports
// vendorCostCents, never derives credit cost or charges anything itself.
// compSource/propertyDataSource/toolUseDetail are optional behavioral facts
// (not cost) work may report for the ToolUse row it ran under — no protocol
// violation, just data the caller is best-placed to know.
export type MeteredWork<T> = (toolUseId: string) => Promise<{
  result: T
  vendorCostCents: number
  compSource?: string | null
  propertyDataSource?: string | null
  toolUseDetail?: ToolUseDetail | null
}>

export type MeterOutcome =
  | { outcome: 'blocked'; decision: 'blocked' }
  // Admin entitlement bypass — tracked (ToolUse + ApiCall are real), not
  // metered (no LedgerEntry, no debit, no wallet/allowance touched at all).
  | { outcome: 'admin'; toolUseId: string }
  | {
      outcome: 'charged'
      decision: 'allowance' | 'credit'
      creditsDebited: number
      allowanceCovered: boolean
      balance: number
      remaining: number | null
    }

// The generic two-phase wrapper every metered tool plugs into unchanged.
// member is RESOLVED BY THE CALLER (via lib/requireMember.ts or
// lib/toolsSession.ts's resolveSessionMember) and passed in — this stays
// engine-pure, no next/headers import, no session concerns.
export async function withMeter<T>(
  prisma: PrismaClient,
  member: { userId: string; locationId: string; role: Role },
  featureSlug: string,
  toolId: string,
  kind: string,
  creditCost: number,
  work: MeteredWork<T>,
): Promise<{ result: T | null; meter: MeterOutcome }> {
  const isAdmin = member.role === 'admin'

  // Admin is entitled-to-everything and un-metered: skip precheck entirely,
  // never touch the wallet/allowance. A non-admin still goes through the
  // strict two-phase gate.
  let decision: 'allowance' | 'credit' | null = null
  if (!isAdmin) {
    const precheckDecision = await precheck(prisma, member.userId, featureSlug, creditCost)

    // Blocked is control flow, not an error — return, never throw. No vendor
    // spend, work() never runs, no ToolUse row (nothing was attempted).
    if (precheckDecision === 'blocked') {
      return { result: null, meter: { outcome: 'blocked', decision: 'blocked' } }
    }
    decision = precheckDecision
  }

  // Open ToolUse at RUN START (outcome defaults to 'fail' — see openToolUse),
  // not at completion, so a crash mid-run or a failed work() still leaves a
  // real ToolUse row with its real ApiCall/cost children — failure-spend
  // tracking is the point, not an afterthought.
  const { id: toolUseId } = await openToolUse(prisma, {
    userId: member.userId,
    locationId: member.locationId,
    isAdmin,
    featureSlug,
    kind,
  })

  let workResult: Awaited<ReturnType<MeteredWork<T>>>
  try {
    workResult = await work(toolUseId)
  } catch (err) {
    const vendorCostCents = err instanceof MeteredWorkError ? err.vendorCostCents : 0
    try {
      if (isAdmin) {
        await finalizeToolUse(prisma, toolUseId, { outcome: 'fail' })
      } else {
        await recordFailure(prisma, member.userId, featureSlug, toolId, vendorCostCents, toolUseId)
      }
    } catch {
      // A failed fail-log must never mask the real tool error below.
    }
    throw err
  }

  if (isAdmin) {
    await finalizeToolUse(prisma, toolUseId, { outcome: 'success' })
    return { result: workResult.result, meter: { outcome: 'admin', toolUseId } }
  }

  await chargeOnSuccess(
    prisma,
    member.userId,
    featureSlug,
    toolId,
    decision as 'allowance' | 'credit',
    creditCost,
    workResult.vendorCostCents,
    toolUseId,
    {
      compSource: workResult.compSource,
      propertyDataSource: workResult.propertyDataSource,
      detail: workResult.toolUseDetail,
    },
  )

  // Fresh post-charge state — the surface reflects the new balance/allowance
  // with no refetch.
  const resolved = await resolveFeature(prisma, member.userId, featureSlug)

  return {
    result: workResult.result,
    meter: {
      outcome: 'charged',
      decision: decision as 'allowance' | 'credit',
      creditsDebited: decision === 'credit' ? creditCost : 0,
      allowanceCovered: decision === 'allowance',
      balance: resolved.balance,
      remaining: resolved.remaining,
    },
  }
}
