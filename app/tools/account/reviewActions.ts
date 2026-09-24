'use server'

// Phase 4 — the member's side of the review feed: approving an admin-
// proposed upgrade/downgrade/cancel. Two-call shape mirroring Phase 3's
// break/cancel gate (compute-then-confirm-then-commit): preview computes and
// shows the disclosure with NO write; only the commit call (the member's
// approval) writes the MemberAction, in the same tx as the entitlement
// change (lib/engine/finalizeProposal.ts#finalizeProposedChangeCore).
//
// Member-gated (resolveSessionUserId) — this is the MEMBER approving their
// own proposal, not an admin action.

import { prisma } from '@/lib/prisma'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { computeProposalDisclosure, finalizeProposedChangeCore } from '@/lib/engine/finalizeProposal'
import type { SurvivorLine } from '@/lib/engine/subscriptionBreak'

export type { SurvivorLine }

export type PreviewProposalResult =
  | { ok: true; disclosureText: string; breaks: boolean; survivorLines: SurvivorLine[] }
  | { error: string }

export async function previewProposalAction(adminActionId: string): Promise<PreviewProposalResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    const disclosure = await computeProposalDisclosure(prisma, { userId, adminActionId })
    return {
      ok: true,
      disclosureText: disclosure.disclosureText,
      breaks: disclosure.breaks,
      survivorLines: disclosure.survivorLines,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not preview this proposal.' }
  }
}

export type CommitProposalResult = { ok: true } | { error: string }

export async function commitProposalAction(adminActionId: string, disclosureText: string): Promise<CommitProposalResult> {
  const userId = await resolveSessionUserId(prisma)
  if (!userId) return { error: 'Not signed in.' }

  try {
    await prisma.$transaction((tx) => finalizeProposedChangeCore(tx, { userId, adminActionId, disclosureText }))
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not complete this change.' }
  }
}
