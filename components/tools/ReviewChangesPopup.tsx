'use client'

// Phase 4 tools-entry popup — mirrors ChoiceModal's Modal-shell pattern, but
// its `open` state is seeded from server-fetched data (getOpenChangesForMember,
// passed down by app/tools/page.tsx) rather than a client click event.
//
// Non-blocking, always: the member can always reach the tools. Dismissal is
// SESSION-scoped (not permanent, not a DB write) for a neutral set of
// proposals — a benign add doesn't nag every navigation. A bill-raising
// proposal (raisesBill on the derived feed item, lib/reviewFeed.ts) is the
// §6a anti-silent-reprice / anti-rogue-admin lane: it re-surfaces on every
// tools-entry and can't be dismissed away for the session, though the member
// is never locked out of the tools over it.

import { useEffect, useState } from 'react'
import Modal from '@/components/shared/Modal'
import ReviewChangesList from '@/components/shared/ReviewChangesList'
import type { ReviewItem } from '@/lib/reviewFeed'

const DISMISS_KEY = 'reitools:reviewPopupDismissed'

export default function ReviewChangesPopup({ items }: { items: ReviewItem[] }) {
  const hasBillRaise = items.some((item) => item.raisesBill)

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (hasBillRaise) return false
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  // If the set of open items turns bill-raising (e.g. an admin proposal
  // lands while this page is mounted and a client refresh brings it in),
  // override any earlier session dismissal rather than waiting for remount.
  useEffect(() => {
    if (hasBillRaise) setDismissed(false)
  }, [hasBillRaise])

  function close() {
    if (!hasBillRaise) {
      try {
        sessionStorage.setItem(DISMISS_KEY, '1')
      } catch {
        // sessionStorage unavailable (private mode, etc.) — falls back to
        // per-mount dismissal only, never a hard failure.
      }
    }
    setDismissed(true)
  }

  const open = items.length > 0 && !dismissed

  return (
    <Modal open={open} onClose={close}>
      <h2 className="text-lg font-semibold mb-1">
        {hasBillRaise ? 'Action needed — a proposed change raises your bill' : 'Changes to review'}
      </h2>
      <p className="text-sm text-silver mb-6">
        {hasBillRaise
          ? "An admin has proposed a change that increases your recurring cost. Nothing changes until you review it — approve or decline below."
          : 'An admin has proposed the following for your account. Nothing changes until you review and approve.'}
      </p>
      <ReviewChangesList items={items} />
    </Modal>
  )
}
