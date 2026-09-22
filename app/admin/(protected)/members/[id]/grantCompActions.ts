'use server'

// v1.5 slice 3 — the admin-DIRECT exception (§6b): grant credits and comp a
// subscription tier EXECUTE immediately on admin click. Unlike actions.ts
// (this dossier's PROPOSE surface, which always waits for the member),
// nothing here routes through a cart, a proposal, or a MemberAction — this
// is the OP-borne immediate exception, not a member-consent path.

import { prisma } from '@/lib/prisma'
import { requireAdmin, RequireAdminError } from '@/lib/requireAdmin'
import { fund } from '@/lib/engine/funding'
import { compFreeMonth } from '@/lib/engine/comp'

async function requireAdminUserId(): Promise<string | { error: string }> {
  try {
    const admin = await requireAdmin(prisma)
    return admin.userId
  } catch (err) {
    if (err instanceof RequireAdminError) return { error: 'Not authorized.' }
    throw err
  }
}

export type GrantCreditsResult = { ok: true } | { error: string }

// fund() is a money-only core — it does NOT write an AdminAction (see
// lib/engine/funding.ts). This action opens the ONE transaction: create the
// AdminAction first (targetType 'user', no ledger fields — §6/§8, the money
// lives on the LedgerEntry, not here), then call fund() with refId set to
// that AdminAction's id — the same refId-correlation pattern the Stripe
// webhook already uses (lib/stripe/webhookHandlers.ts), just admin-sourced
// instead of a Stripe session id. A fund() failure rolls the AdminAction
// back too, since both run on the same tx client.
export async function grantCreditsAction(memberUserId: string, credits: number, note: string): Promise<GrantCreditsResult> {
  const adminUserId = await requireAdminUserId()
  if (typeof adminUserId !== 'string') return adminUserId

  if (!Number.isInteger(credits) || credits <= 0) {
    return { error: 'Enter a whole number of credits greater than zero.' }
  }
  if (!note.trim()) {
    return { error: 'A reason is required for a credit grant.' }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const action = await tx.adminAction.create({
        data: {
          adminUserId,
          action: 'credit_grant',
          targetType: 'user',
          targetId: memberUserId,
          note,
        },
      })
      await fund(tx, memberUserId, credits, 'admin_grant', { refId: action.id })
    })
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not grant credits.' }
  }
}

export type CompMonthResult = { ok: true } | { error: string }

// compFreeMonth writes its OWN AdminAction internally (subscription_comp,
// targetType 'user') — this action must NOT write a second one. Its tx is
// non-optional by design (the entitlement write and its AdminAction must
// commit atomically), so this just opens the one tx and calls it straight
// through.
export async function compMonthAction(memberUserId: string, featureId: string, tierId: string, note: string): Promise<CompMonthResult> {
  const adminUserId = await requireAdminUserId()
  if (typeof adminUserId !== 'string') return adminUserId

  if (!featureId || !tierId) {
    return { error: 'Pick a feature and tier to comp.' }
  }

  const periodStart = new Date()
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000)

  try {
    await prisma.$transaction((tx) =>
      compFreeMonth(tx, {
        adminUserId,
        userId: memberUserId,
        tierId,
        featureId,
        periodStart,
        periodEnd,
        note: note.trim() || undefined,
      }),
    )
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not comp this tier.' }
  }
}
