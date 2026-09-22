'use client'

// Phase 3.5 dossier wiring — functional, not a design pass. Every control
// here writes a PROPOSAL (AdminAction, + a Cart for adds) via
// lib/engine/adminProposals.ts — never an entitlement change. Copy reads as
// "propose/stage" throughout so it's clear the MEMBER completes it.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/shared/Modal'
import { formatCents } from '@/lib/money'
import {
  stageSubscriptionAddAction,
  proposeSubscriptionChangeAction,
  overrideMemberCartAction,
} from '@/app/admin/(protected)/members/[id]/actions'
import type { SubRow } from '@/lib/adminMemberDetail'
import type { SubscribableFeature } from '@/lib/adminSubscribableCatalog'

const btnPrimary =
  'rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-black hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50'
const btnOutline =
  'rounded-md border border-border-default px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const btnQuiet = 'rounded-md px-3 py-1.5 text-xs font-semibold text-white/40 hover:text-white/70'

interface MemberSubscriptionsPanelProps {
  memberUserId: string
  bundleSlug: string | null
  bundleLabel: string | null
  subs: SubRow[]
  catalog: SubscribableFeature[]
}

type ManageTarget = { sub: SubRow } | null
type AddState = { featureId: string; tierId: string } | null
// Direction 2 (5a) — the member already has an open cart. Set only after
// stageSubscriptionAddAction returns requiresOverrideConfirm; the admin must
// explicitly confirm before overrideMemberCartAction runs.
type OverrideConfirm = { tierId: string } | null

export default function MemberSubscriptionsPanel({ memberUserId, bundleSlug, bundleLabel, subs, catalog }: MemberSubscriptionsPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [manageTarget, setManageTarget] = useState<ManageTarget>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addState, setAddState] = useState<AddState>(null)
  const [overrideConfirm, setOverrideConfirm] = useState<OverrideConfirm>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const heldFeatureIds = new Set(subs.map((s) => s.featureId))
  const addableFeatures = catalog.filter((f) => !heldFeatureIds.has(f.featureId))

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  function openAdd() {
    const first = addableFeatures[0]
    setAddState(first ? { featureId: first.featureId, tierId: first.tiers[0]?.tierId ?? '' } : null)
    setError(null)
    setAddOpen(true)
  }

  function submitAdd() {
    if (!addState || !addState.tierId) return
    const tierId = addState.tierId
    startTransition(async () => {
      const result = await stageSubscriptionAddAction(memberUserId, addState.featureId, tierId)
      if ('error' in result) {
        setError(result.error)
        return
      }
      if ('requiresOverrideConfirm' in result) {
        // Direction 2 (5a): block, don't auto-expire. Nothing was written —
        // route to the confirm prompt.
        setAddOpen(false)
        setOverrideConfirm({ tierId })
        return
      }
      setAddOpen(false)
      showToast('Staged — the member will see this to complete at checkout.')
      router.refresh()
    })
  }

  function confirmOverride() {
    if (!overrideConfirm) return
    const { tierId } = overrideConfirm
    startTransition(async () => {
      const result = await overrideMemberCartAction(memberUserId, tierId)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setOverrideConfirm(null)
      showToast('Cart replaced — the member will see this to complete at checkout.')
      router.refresh()
    })
  }

  function submitChange(sub: SubRow, changeType: 'cancel' | 'tier_change', newTierId?: string) {
    setError(null)
    startTransition(async () => {
      const result = await proposeSubscriptionChangeAction(memberUserId, sub.featureId, changeType, newTierId)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setManageTarget(null)
      showToast('Proposed — the member will see this to review and approve.')
      router.refresh()
    })
  }

  const manageCatalogEntry = manageTarget ? catalog.find((f) => f.featureId === manageTarget.sub.featureId) : undefined

  return (
    <div className="rounded-xl border border-border-default bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Subscriptions</span>
        <button type="button" className={btnOutline} onClick={() => setManageTarget(subs[0] ? { sub: subs[0] } : null)} disabled={subs.length === 0}>
          Manage
        </button>
      </div>
      <div className="space-y-2.5">
        {subs.length === 0 && <p className="text-sm text-white/40">No active subscriptions.</p>}
        {subs.map((s) => (
          <div key={s.featureSlug} className="flex items-center justify-between rounded-lg border border-border-default bg-black px-3 py-2.5">
            <img src={s.wordmark} alt={s.displayName} className="h-4.5 w-auto" />
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-border-default bg-white/5 px-2 py-0.5 text-[10.5px] font-semibold text-white/70">{s.displayName}</span>
              <span className="text-xs font-semibold tabular-nums text-white/70">{formatCents(s.priceCents)}/mo</span>
              <button type="button" className={btnQuiet} onClick={() => setManageTarget({ sub: s })}>
                Manage
              </button>
            </div>
          </div>
        ))}
        {bundleSlug && bundleLabel && (
          <span className="inline-block rounded-md border border-gold-hover/60 bg-gold/10 px-2 py-0.5 text-[10.5px] font-semibold text-gold">
            {bundleLabel}
          </span>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className={btnOutline} onClick={openAdd} disabled={addableFeatures.length === 0}>
          + Add subscription
        </button>
      </div>

      {/* Manage: propose upgrade/downgrade/cancel on an existing line */}
      <Modal open={manageTarget !== null} onClose={() => setManageTarget(null)}>
        {manageTarget && (
          <>
            <h2 className="text-lg font-semibold text-white mb-1">Manage {manageTarget.sub.displayName}</h2>
            <p className="text-sm text-white/60 mb-4">
              This proposes a change — the member reviews and approves it before anything on their entitlement or bill changes.
            </p>
            {error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{error}</div>}
            <div className="flex flex-col gap-2 mb-4">
              {manageCatalogEntry?.tiers
                .filter((t) => t.tierId !== manageTarget.sub.tierId)
                .map((t) => (
                  <button
                    key={t.tierId}
                    type="button"
                    disabled={isPending}
                    className="flex items-center justify-between rounded-lg border border-border-default bg-black px-3 py-2.5 text-sm text-white hover:border-gold disabled:opacity-50"
                    onClick={() => submitChange(manageTarget.sub, 'tier_change', t.tierId)}
                  >
                    <span>Propose {t.priceCents > (manageCatalogEntry.tiers.find((x) => x.tierId === manageTarget.sub.tierId)?.priceCents ?? 0) ? 'upgrade' : 'downgrade'} to {t.displayName}</span>
                    <span className="tabular-nums text-white/60">{formatCents(t.priceCents)}/mo</span>
                  </button>
                ))}
            </div>
            <div className="flex justify-between gap-3">
              <button
                type="button"
                disabled={isPending}
                className="rounded-md border border-red/40 px-3 py-1.5 text-xs font-semibold text-red hover:bg-red/10 disabled:opacity-50"
                onClick={() => submitChange(manageTarget.sub, 'cancel')}
              >
                Propose cancel
              </button>
              <button type="button" className={btnQuiet} onClick={() => setManageTarget(null)}>
                Never mind
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Add: stage a new line via an admin_staged Cart */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <h2 className="text-lg font-semibold text-white mb-1">Stage a subscription</h2>
        <p className="text-sm text-white/60 mb-4">
          This stages a cart for the member — they complete checkout themselves. Nothing is charged or activated here.
        </p>
        {error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{error}</div>}
        {addableFeatures.length === 0 ? (
          <p className="text-sm text-white/40 mb-4">This member already holds every available feature.</p>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            <label className="text-xs text-white/60">
              Feature
              <select
                className="mt-1 w-full rounded-md border border-border-default bg-black px-3 py-2 text-sm text-white"
                value={addState?.featureId ?? ''}
                onChange={(e) => {
                  const feature = addableFeatures.find((f) => f.featureId === e.target.value)
                  setAddState(feature ? { featureId: feature.featureId, tierId: feature.tiers[0]?.tierId ?? '' } : null)
                }}
              >
                {addableFeatures.map((f) => (
                  <option key={f.featureId} value={f.featureId}>
                    {f.featureSlug}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/60">
              Tier
              <select
                className="mt-1 w-full rounded-md border border-border-default bg-black px-3 py-2 text-sm text-white"
                value={addState?.tierId ?? ''}
                onChange={(e) => setAddState((prev) => (prev ? { ...prev, tierId: e.target.value } : prev))}
              >
                {addableFeatures
                  .find((f) => f.featureId === addState?.featureId)
                  ?.tiers.map((t) => (
                    <option key={t.tierId} value={t.tierId}>
                      {t.displayName} — {formatCents(t.priceCents)}/mo
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className={btnQuiet} onClick={() => setAddOpen(false)}>
            Never mind
          </button>
          <button type="button" className={btnPrimary} disabled={isPending || !addState?.tierId} onClick={submitAdd}>
            Stage it
          </button>
        </div>
      </Modal>

      {/* Direction 2 (5a): the member has an active cart — block, don't auto-expire. */}
      <Modal open={overrideConfirm !== null} onClose={() => setOverrideConfirm(null)}>
        <h2 className="text-lg font-semibold text-white mb-1">This member has an active cart</h2>
        <p className="text-sm text-white/60 mb-4">
          Confirm they've agreed — on the call — to replace it with this proposal. Their in-progress cart will be discarded and
          replaced.
        </p>
        {error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{error}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" className={btnQuiet} onClick={() => setOverrideConfirm(null)}>
            Don't override
          </button>
          <button type="button" className={btnPrimary} disabled={isPending} onClick={confirmOverride}>
            Confirm — replace their cart
          </button>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 z-30 rounded-lg bg-surface border border-gold px-4 py-3 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  )
}
