'use client'

// Phase 4's shared render — the same item list + review flow is embedded
// both in the tools-entry popup (components/tools/ReviewChangesPopup.tsx)
// and the member account page's inline zone (components/account/ReviewZone.tsx),
// so the preview/commit logic lives exactly once.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/shared/Card'
import Button from '@/components/shared/Button'
import Modal from '@/components/shared/Modal'
import Tag from '@/components/shared/Tag'
import { previewProposalAction, commitProposalAction, type SurvivorLine } from '@/app/tools/account/reviewActions'
import { previewCheckoutConsentAction, commitCheckoutConsentAction } from '@/app/tools/store/checkoutConsentActions'
import { declineStagedCartAction } from '@/app/tools/store/cartActions'
import type { ReviewItem } from '@/lib/reviewFeed'

const DIRECTION_LABEL: Record<string, string> = {
  subscription_upgrade: 'upgrade',
  subscription_downgrade: 'downgrade',
  subscription_cancel: 'cancel',
}

// Slice 2 — change-path proposals have no decline engine core (that's a
// future schema chat: an append-only rejection back to the admin). They're
// safe-by-construction without one — nothing is written until the member
// approves — so "Decline" here is copy + a client-side, session-scoped
// dismissal, same mechanism as the tools-entry popup's neutral dismissal
// (components/tools/ReviewChangesPopup.tsx). No DB write, no persistence.
const DECLINED_KEY = 'reitools:reviewChangesDeclined'

function loadDeclined(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DECLINED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function saveDeclined(ids: Set<string>) {
  try {
    sessionStorage.setItem(DECLINED_KEY, JSON.stringify([...ids]))
  } catch {
    // sessionStorage unavailable — decline still applies for this mount.
  }
}

interface PendingReview {
  adminActionId: string
  featureSlug: string
  disclosureText: string | null
  breaks: boolean | null
  survivorLines: SurvivorLine[]
  error: string | null
}

// 5b, PATH 2 — completing an admin-staged cart IS consent by construction:
// the member checking out the cart themselves is the approval. Same
// preview-then-approve shape as the change-path review above, keyed by
// cartId instead of adminActionId, and the consent write (targetType:'Cart')
// is a different carrier — see lib/engine/checkoutConsent.ts.
interface PendingCheckout {
  cartId: string
  disclosureText: string | null
  type: 'subscription_add' | 'credit_pack_purchase' | null
  error: string | null
}

export default function ReviewChangesList({ items }: { items: ReviewItem[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [review, setReview] = useState<PendingReview | null>(null)
  const [checkout, setCheckout] = useState<PendingCheckout | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [declined, setDeclined] = useState<Set<string>>(() => loadDeclined())

  function openReview(adminActionId: string, featureSlug: string) {
    setReview({ adminActionId, featureSlug, disclosureText: null, breaks: null, survivorLines: [], error: null })
    startTransition(async () => {
      const result = await previewProposalAction(adminActionId)
      setReview((current) => {
        if (!current || current.adminActionId !== adminActionId) return current
        if ('error' in result) return { ...current, error: result.error }
        return { ...current, disclosureText: result.disclosureText, breaks: result.breaks, survivorLines: result.survivorLines }
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

  function openCheckoutConsent(cartId: string) {
    setCheckout({ cartId, disclosureText: null, type: null, error: null })
    startTransition(async () => {
      const result = await previewCheckoutConsentAction(cartId)
      setCheckout((current) => {
        if (!current || current.cartId !== cartId) return current
        if ('error' in result) return { ...current, error: result.error }
        return { ...current, disclosureText: result.disclosureText, type: result.type }
      })
    })
  }

  function declineChange(adminActionId: string) {
    setDeclined((current) => {
      const next = new Set(current)
      next.add(adminActionId)
      saveDeclined(next)
      return next
    })
    setReview(null)
  }

  function declineAdd(cartId: string) {
    startTransition(async () => {
      const result = await declineStagedCartAction(cartId)
      if ('error' in result) {
        setToast(result.error)
        setTimeout(() => setToast(null), 4000)
        return
      }
      setToast('Declined — the proposal was removed.')
      setTimeout(() => setToast(null), 4000)
      router.refresh()
    })
  }

  function approveCheckout() {
    if (!checkout || !checkout.disclosureText || !checkout.type) return
    const { cartId, disclosureText, type } = checkout
    startTransition(async () => {
      const result = await commitCheckoutConsentAction(cartId, disclosureText, type)
      if ('error' in result) {
        setCheckout((current) => (current ? { ...current, error: result.error } : current))
        return
      }
      setCheckout(null)
      setToast('Approved — checkout confirmed.')
      setTimeout(() => setToast(null), 4000)
      router.refresh()
    })
  }

  const visibleItems = items.filter((item) => item.kind !== 'change' || !declined.has(item.adminActionId))

  if (visibleItems.length === 0) {
    return <p className="text-sm text-silver">No changes awaiting your review.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {visibleItems.map((item) => {
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
                <div className="flex items-center gap-2">
                  <Button variant="quiet" size="sm" disabled={isPending} onClick={() => declineAdd(item.cartId)}>
                    Decline
                  </Button>
                  <Button variant="gold-outline" size="sm" onClick={() => openCheckoutConsent(item.cartId)}>
                    Complete checkout
                  </Button>
                </div>
              </div>
            </Card>
          )
        }

        const direction = DIRECTION_LABEL[item.action] ?? item.action
        return (
          <Card key={item.adminActionId} variant={item.raisesBill ? 'highlight' : 'default'} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold">
                    An admin proposed a {direction} on this line
                  </div>
                  {item.raisesBill && <Tag tone="gold">Raises your bill</Tag>}
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
                {review.breaks && review.survivorLines.length > 0 && (
                  <ul className="flex flex-col gap-1 mb-2">
                    {review.survivorLines.map((line) => (
                      <li key={line.featureSlug} className="flex items-center justify-between text-sm">
                        <span className="text-silver">
                          {line.featureSlug} ({line.tierLevel})
                        </span>
                        <span>
                          {/* Delta-ready, mirrors SubscriptionsZone's survivor-line
                              render (§13 go-live item) — from is always null on this
                              DB-only leg, so today this renders to-only. */}
                          {line.delta.from !== null && (
                            <span className="line-through text-silver/50 mr-1.5">
                              ${(line.delta.from / 100).toFixed(2)}
                            </span>
                          )}
                          <span className="text-gold font-medium">${(line.delta.to / 100).toFixed(2)}/mo</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {review.disclosureText}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="quiet" size="sm" onClick={() => declineChange(review.adminActionId)}>
                Decline
              </Button>
              <Button variant="gold" size="sm" disabled={!review.disclosureText} loading={isPending} onClick={approve}>
                Approve &amp; confirm
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* 5b, PATH 2 — completing the staged cart IS consent by construction. */}
      <Modal open={checkout !== null} onClose={() => setCheckout(null)}>
        {checkout && (
          <>
            <h2 className="text-lg font-semibold mb-1">Confirm this checkout</h2>
            {checkout.error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{checkout.error}</div>}
            {!checkout.disclosureText && !checkout.error && (
              <div className="text-sm text-silver mb-4">Computing what you're about to approve…</div>
            )}
            {checkout.disclosureText && (
              <div className="rounded-lg border border-gold bg-gold/5 p-3 mb-4 text-sm text-silver leading-relaxed">
                {checkout.disclosureText}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="quiet" size="sm" onClick={() => setCheckout(null)}>
                Not now
              </Button>
              <Button variant="gold" size="sm" disabled={!checkout.disclosureText} loading={isPending} onClick={approveCheckout}>
                Approve &amp; checkout
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
