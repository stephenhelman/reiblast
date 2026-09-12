'use server'

import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { signOnboardingCookie, type OnboardingIdentity } from '@/lib/onboardingSession'
import {
  ONBOARDING_COOKIE,
  ONBOARDING_COOKIE_MAX_AGE_SECONDS,
  DISCOVERY_HQ_UPDATE_CONTACT_URL,
  DISCOVERY_OPWS_INBOUND_WEBHOOK_URL,
} from '@/lib/constants'

/** Sets the onboarding-identity cookie. Real call site is onboarding-submit (a follow-up
 * chat); this same action also backs the manual-entry path here and the dev preview
 * simulate-cookie button below. Host-only cookie — no `domain`, see lib/onboardingSession.ts. */
export async function setOnboardingCookieAction(identity: OnboardingIdentity): Promise<void> {
  const token = await signOnboardingCookie(identity)
  const cookieStore = await cookies()
  cookieStore.set(ONBOARDING_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ONBOARDING_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  })
}

/** Dev-only preview affordance — simulates the cookie-absent path without clearing real state. */
export async function clearOnboardingCookieAction(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(ONBOARDING_COOKIE)
}

/**
 * Best-effort contact lookup for the manual-entry path — NEVER blocks progression.
 * Real GHL contact mapping is the other chat; this only checks whether we already
 * have a User row (and thus a ghlContactId) for the email they typed.
 */
export async function resolveContactByEmail(email: string): Promise<string | null> {
  try {
    const user = await prisma.user.findUnique({ where: { email } })
    return user?.ghlContactId ?? null
  } catch {
    return null
  }
}

export interface DiscoverySubmitPayloads {
  hq: { contactId: string; list: string[] } | null
  opws: { email: string; name: string; phone: string; list: string[] }
}

/**
 * Terminal action. Assembles the two forked payloads and stub-fires them —
 * real mapping/opp creation/tag writes/HQ-field write are the other chat.
 * Both sinks are logged; a best-effort POST is attempted against the
 * config-placeholder URLs but failures are swallowed (there is nothing real
 * listening there yet).
 */
export async function submitDiscoveryListAction(
  identity: { contactId: string | null; name: string; email: string; phone: string },
  list: string[],
): Promise<DiscoverySubmitPayloads> {
  // HQ update-contact is HQ-scoped and needs a real contactId — skip firing it
  // rather than sending a null/garbage contactId when one never resolved.
  const hq = identity.contactId ? { contactId: identity.contactId, list } : null;
  const opws = { email: identity.email, name: identity.name, phone: identity.phone, list };

  console.log('[discovery] STUB HQ update-contact ->', DISCOVERY_HQ_UPDATE_CONTACT_URL, hq)
  console.log('[discovery] STUB OPWS inbound webhook ->', DISCOVERY_OPWS_INBOUND_WEBHOOK_URL, opws)

  if (hq) {
    fetch(DISCOVERY_HQ_UPDATE_CONTACT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hq),
    }).catch(() => {
      // Placeholder endpoint — expected to fail until the real HQ chat wires it up.
    })
  }

  fetch(DISCOVERY_OPWS_INBOUND_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opws),
  }).catch(() => {
    // Placeholder endpoint — expected to fail until the real OPWS chat wires it up.
  })

  return { hq, opws }
}
