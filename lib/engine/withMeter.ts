import { PrismaClient } from '@prisma/client'
import { chargeOnSuccess, precheck, recordFailure } from './meter'
import { resolveFeature } from './resolver'

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

export type MeteredWork<T> = () => Promise<{ result: T; vendorCostCents: number }>

export type MeterOutcome =
  | { outcome: 'blocked'; decision: 'blocked' }
  | {
      outcome: 'charged'
      decision: 'allowance' | 'credit'
      creditsDebited: number
      allowanceCovered: boolean
      balance: number
      remaining: number | null
    }

// The generic two-phase wrapper every metered tool plugs into unchanged.
// userId is RESOLVED BY THE CALLER (via lib/toolsSession.ts's
// resolveSessionUserId) and passed in — this stays engine-pure, no
// next/headers import, no session concerns.
export async function withMeter<T>(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
  toolId: string,
  creditCost: number,
  work: MeteredWork<T>,
): Promise<{ result: T | null; meter: MeterOutcome }> {
  const decision = await precheck(prisma, userId, featureSlug, creditCost)

  // Blocked is control flow, not an error — return, never throw. No vendor
  // spend, work() never runs.
  if (decision === 'blocked') {
    return { result: null, meter: { outcome: 'blocked', decision: 'blocked' } }
  }

  let workResult: { result: T; vendorCostCents: number }
  try {
    workResult = await work()
  } catch (err) {
    const vendorCostCents = err instanceof MeteredWorkError ? err.vendorCostCents : 0
    try {
      await recordFailure(prisma, userId, featureSlug, toolId, vendorCostCents)
    } catch {
      // A failed fail-log must never mask the real tool error below.
    }
    throw err
  }

  await chargeOnSuccess(
    prisma,
    userId,
    featureSlug,
    toolId,
    decision,
    creditCost,
    workResult.vendorCostCents,
  )

  // Fresh post-charge state — the surface reflects the new balance/allowance
  // with no refetch.
  const resolved = await resolveFeature(prisma, userId, featureSlug)

  return {
    result: workResult.result,
    meter: {
      outcome: 'charged',
      decision,
      creditsDebited: decision === 'credit' ? creditCost : 0,
      allowanceCovered: decision === 'allowance',
      balance: resolved.balance,
      remaining: resolved.remaining,
    },
  }
}
