'use client'

// ZONE 4 — changes to review, a peer of Wallet/Subscriptions/Ledger. Same
// feed + review flow as the tools-entry popup (components/shared/
// ReviewChangesList.tsx), just rendered inline instead of in a modal.

import ReviewChangesList from '@/components/shared/ReviewChangesList'
import type { ReviewItem } from '@/lib/reviewFeed'

export default function ReviewZone({ items }: { items: ReviewItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Changes to review</h2>
      <ReviewChangesList items={items} />
    </div>
  )
}
