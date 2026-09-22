'use client'

// Phase 4's shared render — the same item list + review flow is embedded
// both in the tools-entry popup (components/tools/ReviewChangesPopup.tsx)
// and the member account page's inline zone (components/account/ReviewZone.tsx),
// so the preview/commit logic lives exactly once.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Card from '@/components/shared/Card'
import Button from '@/components/shared/Button'
import Modal from '@/components/shared/Modal'
import { buildStoreLink } from '@/lib/storeLink'
import { previewProposalAction, commitProposalAction } from '@/app/tools/account/reviewActions'
import type { ReviewItem } from '@/lib/reviewFeed'

const DIRECTION_LABEL: Record<string, string> = {
  subscription_upgrade: 'upgrade',
  subscription_downgrade: 'downgrade',
  subscription_cancel: 'cancel',
}

interface PendingReview {
  adminActionId: string
  featureSlug: string
  disclosureText: string | null
  error: string | null
}

export default function ReviewChangesList({ items }: { items: ReviewItem[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [review, setReview] = useState<PendingReview | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function openReview(adminActionId: string, featureSlug: string) {
    setReview({ adminActionId, featureSlug, disclosureText: null, error: null })
    startTransition(async () => {
      const result = await previewProposalAction(adminActionId)
      setReview((current) => {
        if (!current || current.adminActionId !== adminActionId) return current
        if ('error' in result) return { ...current, error: result.error }
        return { ...current, disclosureText: result.disclosureText }
      })
    })
  }

  function approve() {
    if (!review || !review.disclosureText) return
    const { adminActionId, disclosureText } = review
    startTransition(async () => {
      const result = await commitProposalAction(adminActionId, disclosureText)
      if ('error' in result) {
        setReview((current) => (current ? { ...current, error: result.error } : current))
        return
      }
      setReview(null)
      setToast('Change confirmed.')
      setTimeout(() => setToast(null), 4000)
      router.refresh()
    })
  }

  if (items.length === 0) {
    return <p className="text-sm text-silver">No changes awaiting your review.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        if (item.kind === 'add') {
          return (
            <Card key={item.cartId} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    An admin proposed adding {item.lines.map((l) => l.displayName).join(', ')}
                  </div>
                  <p className="text-silver mt-1">
                    {item.state === 'consented'
                      ? 'You approved this — complete checkout to finish activating it.'
                      : 'Complete checkout to accept — nothing is charged or activated until you do.'}
                  </p>
                </div>
                <Link href={buildStoreLink({ from: 'review-feed', intent: 'addon' })}>
                  <Button variant="gold-outline" size="sm">
                    Go to checkout
                  </Button>
                </Link>
              </div>
            </Card>
          )
        }

        const direction = DIRECTION_LABEL[item.action] ?? item.action
        return (
          <Card key={item.adminActionId} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">
                  An admin proposed a {direction} on this line
                </div>
                <p className="text-silver mt-1">
                  {item.state === 'consented' ? 'You approved this — finishing up.' : 'Review the details and approve to confirm.'}
                </p>
              </div>
              <Button variant="gold" size="sm" onClick={() => openReview(item.adminActionId, item.featureId)}>
                Review
              </Button>
            </div>
          </Card>
        )
      })}

      <Modal open={review !== null} onClose={() => setReview(null)}>
        {review && (
          <>
            <h2 className="text-lg font-semibold mb-1">Review this change</h2>
            {review.error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{review.error}</div>}
            {!review.disclosureText && !review.error && (
              <div className="text-sm text-silver mb-4">Loading the details of this proposal…</div>
            )}
            {review.disclosureText && (
              <div className="rounded-lg border border-gold bg-gold/5 p-3 mb-4 text-sm text-silver leading-relaxed">
                {review.disclosureText}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="quiet" size="sm" onClick={() => setReview(null)}>
                Not now
              </Button>
              <Button variant="gold" size="sm" disabled={!review.disclosureText} loading={isPending} onClick={approve}>
                Approve &amp; confirm
              </Button>
            </div>
          </>
        )}
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 z-30 rounded-lg bg-surface border border-gold px-4 py-3 text-sm shadow-lg animate-fade-rise">
          {toast}
        </div>
      )}
    </div>
  )
}
