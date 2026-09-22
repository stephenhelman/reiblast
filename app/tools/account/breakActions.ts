'use server'

// The account surface's FIRST member-initiated entitlement write (see
// REItools-Architecture-v3.md §3/§5/§6). Two-call shape, mirroring the
// compute-then-confirm-then-commit model: preview computes and shows the
// disclosure with NO write; commit runs only once the member has seen that
// exact disclosure and approved it — the approval IS the consent event, so
// only the commit call writes a MemberAction, in the same tx as the
// entitlement change (lib/engine/subscriptionBreak.ts#breakSubscriptionCore).
//
// No Stripe here — this proves the DB leg only, on the member's existing
// Subscription rows (see lib/engine/subscriptionLand.ts, already shipped).

import { prisma } from '@/lib/prisma'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { computeBreakDisclosure, breakSubscriptionCore, type ChangeType, type SurvivorLine } from '@/lib/engine/subscriptionBreak'

export type { ChangeType, SurvivorLine }

export type PreviewSubscriptionChangeResult =
  | { ok: true; breaks: boolean; disclosureText: string; survivorLines: SurvivorLine[] }
  | { error: string }

export async function previewSubscriptionChangeAction(
  featureId: string,
  changeType: ChangeType,
  newTierId?: string,
): Promise<PreviewSubscriptionChangeResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    const disclosure = await computeBreakDisclosure(prisma, { userId, featureId, changeType, newTierId })
    return { ok: true, breaks: disclosure.breaks, disclosureText: disclosure.disclosureText, survivorLines: disclosure.survivorLines }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not preview this change.' }
  }
}

export type CommitSubscriptionChangeResult = { ok: true } | { error: string }

export async function commitSubscriptionChangeAction(
  featureId: string,
  changeType: ChangeType,
  newTierId: string | undefined,
  disclosureText: string,
): Promise<CommitSubscriptionChangeResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    await prisma.$transaction((tx) =>
      breakSubscriptionCore(tx, { userId, featureId, changeType, newTierId, disclosureText }),
    )
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not complete this change.' }
  }
}
