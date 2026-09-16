'use client'

import { useState, useTransition } from 'react'
import Card from '@/components/shared/Card'
import Button from '@/components/shared/Button'
import Tag from '@/components/shared/Tag'
import StatusDot from '@/components/shared/StatusDot'
import { requestSubscriptionUpdateAction } from '@/app/tools/account/actions'
import type { AccountSubscription } from '@/types/account'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusTag({ status }: { status: AccountSubscription['status'] }) {
  if (status === 'past_due') return <Tag tone="red">Past due</Tag>
  if (status === 'canceled') return <Tag tone="neutral">Canceled</Tag>
  return <Tag tone="green">Active</Tag>
}

// Presentation-only, like config/storeCopy.ts's STORE_BUNDLE_COPY — the DB
// bundle name isn't fetched onto AccountData (only its slug, for the derived
// currentBundleSlug banner below), so this mirrors it here.
const BUNDLE_DISPLAY_NAME: Record<string, string> = {
  'bundle-plus': 'REItools+',
  'bundle-pro': 'REItools Pro',
}

interface SubscriptionsZoneProps {
  subscriptions: AccountSubscription[]
  /** Derived (lib/entitlement.ts#getCurrentBundleSlug), never a stored row — labels the tool_sub lines below as bundle membership without forcing a fake grouped row into the list. */
  currentBundleSlug: string | null
}

/** ZONE 2 — subscriptions, display-only. No Stripe, no in-app cancel/upgrade — "Update my subscription" only routes to OPWS (app/tools/account/actions.ts). */
export default function SubscriptionsZone({ subscriptions, currentBundleSlug }: SubscriptionsZoneProps) {
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  function handleUpdate(subscriptionId: string) {
    startTransition(async () => {
      await requestSubscriptionUpdateAction(subscriptionId)
      setToast('Request sent — our team will follow up shortly.')
      setTimeout(() => setToast(null), 4000)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Subscriptions</h2>

      {currentBundleSlug && (
        <Card className="border-gold-hover! bg-gold/5">
          <div className="flex items-center gap-2 text-sm">
            <Tag tone="gold">Bundle</Tag>
            <span>
              You're on <b>{BUNDLE_DISPLAY_NAME[currentBundleSlug] ?? currentBundleSlug}</b> — the lines below are priced at your in-bundle rate.
            </span>
          </div>
        </Card>
      )}

      {subscriptions.length === 0 ? (
        <Card className="text-sm text-silver">No active subscriptions — you're on the included Core plan.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {subscriptions.map((sub) => {
            const isPastDue = sub.status === 'past_due'
            return (
              <Card key={sub.id} className={isPastDue ? 'border-red!' : ''}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold">{sub.displayName}</span>
                      <StatusTag status={sub.status} />
                    </div>
                    <ul className="text-sm text-silver list-disc list-inside">
                      {sub.grants.map((grant) => (
                        <li key={grant}>{grant}</li>
                      ))}
                    </ul>
                    {isPastDue ? (
                      <div className="flex items-center gap-2 mt-1">
                        <StatusDot color="red" pulse label={`Payment issue — due ${formatDate(sub.periodEnd)}`} />
                      </div>
                    ) : (
                      <span className="text-xs text-silver mt-1">Renews {formatDate(sub.periodEnd)}</span>
                    )}
                  </div>

                  <Button
                    variant="gold-outline"
                    size="sm"
                    loading={isPending}
                    onClick={() => handleUpdate(sub.id)}
                  >
                    Update my subscription
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-30 rounded-lg bg-surface border border-gold px-4 py-3 text-sm shadow-lg animate-fade-rise">
          {toast}
        </div>
      )}
    </div>
  )
}
