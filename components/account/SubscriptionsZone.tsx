'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/shared/Card'
import Button from '@/components/shared/Button'
import Tag from '@/components/shared/Tag'
import StatusDot from '@/components/shared/StatusDot'
import Modal from '@/components/shared/Modal'
import {
  previewSubscriptionChangeAction,
  commitSubscriptionChangeAction,
  type ChangeType,
  type SurvivorLine,
} from '@/app/tools/account/breakActions'
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

// Pending change awaiting the member's disclosure review — the "compute,
// then confirm, then commit" flow from lib/engine/subscriptionBreak.ts.
interface PendingChange {
  featureId: string
  changeType: ChangeType
  newTierId?: string
  subDisplayName: string
  targetDisplayName: string
  /** null while the preview call is in flight. */
  disclosureText: string | null
  breaks: boolean | null
  survivorLines: SurvivorLine[]
  error: string | null
}

/** ZONE 2 — subscriptions. Downgrade/Cancel are the member's own entitlement writes (phase 3), gated by a MemberAction consent record the member approves before anything is written — see lib/engine/subscriptionBreak.ts. */
export default function SubscriptionsZone({ subscriptions, currentBundleSlug }: SubscriptionsZoneProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingChange | null>(null)

  function openPreview(sub: AccountSubscription, changeType: ChangeType) {
    const targetDisplayName = changeType === 'downgrade' ? sub.downgradeTarget?.displayName ?? '' : 'no plan'
    const next: PendingChange = {
      featureId: sub.featureId,
      changeType,
      newTierId: changeType === 'downgrade' ? sub.downgradeTarget?.tierId : undefined,
      subDisplayName: sub.displayName,
      targetDisplayName,
      disclosureText: null,
      breaks: null,
      survivorLines: [],
      error: null,
    }
    setPending(next)
    startTransition(async () => {
      const result = await previewSubscriptionChangeAction(next.featureId, next.changeType, next.newTierId)
      setPending((current) => {
        if (!current || current.featureId !== next.featureId || current.changeType !== next.changeType) return current
        if ('error' in result) return { ...current, error: result.error }
        return { ...current, disclosureText: result.disclosureText, breaks: result.breaks, survivorLines: result.survivorLines }
      })
    })
  }

  function approve() {
    if (!pending || !pending.disclosureText) return
    const { featureId, changeType, newTierId, disclosureText } = pending
    startTransition(async () => {
      const result = await commitSubscriptionChangeAction(featureId, changeType, newTierId, disclosureText)
      if ('error' in result) {
        setPending((current) => (current ? { ...current, error: result.error } : current))
        return
      }
      setPending(null)
      setToast('Change confirmed.')
      setTimeout(() => setToast(null), 4000)
      router.refresh()
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
            const canEdit = sub.status === 'active'
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

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      {sub.downgradeTarget && (
                        <Button
                          variant="gold-outline"
                          size="sm"
                          loading={isPending && pending?.featureId === sub.featureId && pending.changeType === 'downgrade'}
                          onClick={() => openPreview(sub, 'downgrade')}
                        >
                          Downgrade to {sub.downgradeTarget.displayName}
                        </Button>
                      )}
                      <Button
                        variant="quiet"
                        size="sm"
                        loading={isPending && pending?.featureId === sub.featureId && pending.changeType === 'cancel'}
                        onClick={() => openPreview(sub, 'cancel')}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={pending !== null} onClose={() => setPending(null)}>
        {pending && (
          <>
            <h2 className="text-lg font-semibold mb-1">
              {pending.changeType === 'cancel' ? `Cancel ${pending.subDisplayName}?` : `Downgrade ${pending.subDisplayName}?`}
            </h2>
            <p className="text-sm text-silver mb-4">
              {pending.changeType === 'cancel'
                ? `You're removing this subscription line entirely.`
                : `You're moving this line to ${pending.targetDisplayName}.`}
            </p>

            {pending.error && (
              <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{pending.error}</div>
            )}

            {!pending.disclosureText && !pending.error && (
              <div className="text-sm text-silver mb-4">Checking how this affects your bundle…</div>
            )}

            {pending.disclosureText && (
              <div
                className={`rounded-lg border p-3 mb-4 text-sm ${
                  pending.breaks ? 'border-gold bg-gold/5' : 'border-border-default bg-black/20'
                }`}
              >
                {pending.breaks && <div className="font-semibold text-gold mb-1">This breaks your current bundle.</div>}
                {pending.breaks && pending.survivorLines.length > 0 && (
                  <ul className="flex flex-col gap-1 mb-2">
                    {pending.survivorLines.map((line) => (
                      <li key={line.featureSlug} className="flex items-center justify-between text-sm">
                        <span className="text-silver">
                          {line.featureSlug} ({line.tierLevel})
                        </span>
                        <span>
                          {/* Delta-ready: the from slot exists and renders whenever a
                              real prior rate is available. It's always null on this
                              DB-only leg (§13 go-live item) — nothing here changes
                              when that cache lands, only this condition starts firing. */}
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
                <div className="text-silver leading-relaxed">{pending.disclosureText}</div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="quiet" size="sm" onClick={() => setPending(null)}>
                Never mind
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={!pending.disclosureText}
                loading={isPending}
                onClick={approve}
              >
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
