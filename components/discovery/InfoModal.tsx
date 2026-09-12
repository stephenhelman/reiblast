'use client'

import { useEffect, useState, useTransition } from 'react'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import { resolveContactByEmail, setOnboardingCookieAction } from '@/app/marketing/discovery/actions'
import type { OnboardingIdentity } from '@/lib/onboardingSession'

interface InfoModalProps {
  open: boolean
  onClose: () => void
  /** From the signed onboarding cookie, read at open-time — drives autofill only, not a persistent page card. */
  cookieIdentity: OnboardingIdentity | null
  emailHint: string | null
  listCount: number
  submitting: boolean
  onSubmit: (identity: OnboardingIdentity) => void
}

/**
 * The terminal action's info capture — now a modal, not an inline page gate.
 * Cookie present -> fields autofill from it, framed as confirm/edit. Cookie
 * absent -> blank fields, entered from scratch. Either way the fields stay
 * editable; submitting re-syncs the cookie with whatever's on screen.
 */
export default function InfoModal({ open, onClose, cookieIdentity, emailHint, listCount, submitting, onSubmit }: InfoModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [pending, startTransition] = useTransition()

  // Re-sync fields every time the modal opens fresh — the cookie may have
  // changed since last open (e.g. the dev preview simulate-cookie controls).
  useEffect(() => {
    if (!open) return
    setName(cookieIdentity?.name ?? '')
    setEmail(cookieIdentity?.email ?? emailHint ?? '')
    setPhone(cookieIdentity?.phone ?? '')
  }, [open, cookieIdentity, emailHint])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !email || !phone) return

    startTransition(async () => {
      const contactId = cookieIdentity?.contactId ?? (await resolveContactByEmail(email)) ?? `manual-${email}`
      const identity: OnboardingIdentity = { contactId, name, email, phone }
      await setOnboardingCookieAction(identity)
      onSubmit(identity)
    })
  }

  const busy = pending || submitting

  return (
    <Modal open={open} onClose={onClose} className="max-h-[85vh] overflow-y-auto">
      <h2 className="text-lg font-semibold mb-1">Almost there</h2>
      <p className="text-sm text-silver mb-4">
        {cookieIdentity ? "That's you, right? Edit anything that needs it." : "Tell us who's asking, so we can bring this to your call."}
      </p>

      {listCount === 0 && (
        <p className="text-[12.5px] text-gold mb-4">
          Nothing added yet — that's okay, we can still go over everything on your call.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          required
          className="rounded-lg border border-border-default bg-black px-3.5 py-2.5 text-sm outline-none focus:border-gold-hover"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          required
          className="rounded-lg border border-border-default bg-black px-3.5 py-2.5 text-sm outline-none focus:border-gold-hover"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          placeholder="Phone"
          required
          className="rounded-lg border border-border-default bg-black px-3.5 py-2.5 text-sm outline-none focus:border-gold-hover"
        />

        <div className="flex gap-2.5 mt-2">
          <Button type="button" variant="gold-outline" size="sm" className="flex-1" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button type="submit" variant="gold" size="sm" className="flex-1" disabled={busy}>
            {busy ? 'Sending...' : "I'm ready"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
