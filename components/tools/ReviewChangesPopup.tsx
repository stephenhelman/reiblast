'use client'

// Phase 4 tools-entry popup — mirrors ChoiceModal's Modal-shell pattern, but
// its `open` state is seeded from server-fetched data (getOpenChangesForMember,
// passed down by app/tools/page.tsx) rather than a client click event.

import { useState } from 'react'
import Modal from '@/components/shared/Modal'
import ReviewChangesList from '@/components/shared/ReviewChangesList'
import type { ReviewItem } from '@/lib/reviewFeed'

export default function ReviewChangesPopup({ items }: { items: ReviewItem[] }) {
  const [dismissed, setDismissed] = useState(false)
  const open = items.length > 0 && !dismissed

  return (
    <Modal open={open} onClose={() => setDismissed(true)}>
      <h2 className="text-lg font-semibold mb-1">Changes to review</h2>
      <p className="text-sm text-silver mb-6">
        An admin has proposed the following for your account. Nothing changes until you review and approve.
      </p>
      <ReviewChangesList items={items} />
    </Modal>
  )
}
