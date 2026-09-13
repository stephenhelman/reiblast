'use server'

// Terminal action for the account surface's ONLY outbound effect: "Update my
// subscription" routes to a config-placeholder OPWS endpoint, best-effort,
// failure-swallowing — same pattern as app/marketing/discovery/actions.ts.
// NO Stripe call, NO in-app cancel/upgrade. This surface reads the ledger/
// wallet/subscription tables but writes nothing to them; this action doesn't
// touch those tables either.

import { prisma } from '@/lib/prisma'
import { resolveSessionUserId } from '@/lib/toolsSession'
import { ACCOUNT_SUBSCRIPTION_UPDATE_OPWS_URL } from '@/lib/constants'

export async function requestSubscriptionUpdateAction(subscriptionId: string): Promise<{ ok: true }> {
  const userId = await resolveSessionUserId(prisma)

  const previewMockEnabled =
    process.env.NODE_ENV !== 'production' && process.env.TOOLS_PREVIEW_MOCK_MEMBER === '1'

  const payload = {
    userId: userId ?? (previewMockEnabled ? 'preview-member' : null),
    subscriptionId,
    requestedAt: new Date().toISOString(),
  }

  console.log('[account] STUB OPWS subscription-update ->', ACCOUNT_SUBSCRIPTION_UPDATE_OPWS_URL, payload)

  fetch(ACCOUNT_SUBSCRIPTION_UPDATE_OPWS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Placeholder endpoint — expected to fail until the real OPWS chat wires it up.
  })

  return { ok: true }
}
