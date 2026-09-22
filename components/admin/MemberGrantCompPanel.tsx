'use client'

// v1.5 slice 3 — the admin-DIRECT exception (§6b). Unlike
// MemberSubscriptionsPanel next to it (which PROPOSES and waits for the
// member), every control here EXECUTES immediately on click: no member
// consent, no cart, no MemberAction, no proposal routing. The confirm step
// below exists to make that irreversible-without-a-member-gate fact legible
// to the admin before it fires — this is the OP-borne immediate exception,
// not a shortcut around consent.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/shared/Modal'
import { formatCents } from '@/lib/money'
import { CREDIT_DOLLARS_PER_CREDIT_CENTS } from '@/lib/adminDashboard'
import { grantCreditsAction, compMonthAction } from '@/app/admin/(protected)/members/[id]/grantCompActions'
import type { GrantCompContext, RecentGrantCompAction } from '@/lib/adminGrantComp'
import type { SubscribableFeature } from '@/lib/adminSubscribableCatalog'

const btnPrimary =
  'rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-black hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50'
const btnOutline =
  'rounded-md border border-border-default px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const btnQuiet = 'rounded-md px-3 py-1.5 text-xs font-semibold text-white/40 hover:text-white/70'

interface MemberGrantCompPanelProps {
  memberUserId: string
  memberName: string
  context: GrantCompContext
  recentActions: RecentGrantCompAction[]
  catalog: SubscribableFeature[]
}

type GrantState = { credits: string; note: string } | null
type CompState = { featureId: string; tierId: string; note: string } | null
// Confirm step — states the consequence in plain terms before either write
// fires. 'grant' carries the parsed credits; 'comp' carries the resolved
// feature/tier so the confirm copy can name them.
type ConfirmTarget =
  | { kind: 'grant'; credits: number; note: string }
  | { kind: 'comp'; featureId: string; featureSlug: string; tierId: string; tierLabel: string; note: string }
  | null

const ACTION_LABEL: Record<RecentGrantCompAction['action'], string> = {
  credit_grant: 'Granted credits',
  subscription_comp: 'Comped a tier',
}

export default function MemberGrantCompPanel({ memberUserId, memberName, context, recentActions, catalog }: MemberGrantCompPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantState, setGrantState] = useState<GrantState>(null)
  const [compOpen, setCompOpen] = useState(false)
  const [compState, setCompState] = useState<CompState>(null)
  const [confirm, setConfirm] = useState<ConfirmTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  function openGrant() {
    setGrantState({ credits: '', note: '' })
    setError(null)
    setGrantOpen(true)
  }

  function reviewGrant() {
    if (!grantState) return
    const credits = Number(grantState.credits)
    if (!Number.isInteger(credits) || credits <= 0) {
      setError('Enter a whole number of credits greater than zero.')
      return
    }
    if (!grantState.note.trim()) {
      setError('A reason is required.')
      return
    }
    setError(null)
    setGrantOpen(false)
    setConfirm({ kind: 'grant', credits, note: grantState.note.trim() })
  }

  function openComp() {
    const first = catalog[0]
    setCompState(first ? { featureId: first.featureId, tierId: first.tiers[0]?.tierId ?? '', note: '' } : null)
    setError(null)
    setCompOpen(true)
  }

  function reviewComp() {
    if (!compState || !compState.tierId) return
    const feature = catalog.find((f) => f.featureId === compState.featureId)
    const tier = feature?.tiers.find((t) => t.tierId === compState.tierId)
    if (!feature || !tier) {
      setError('Pick a feature and tier to comp.')
      return
    }
    setError(null)
    setCompOpen(false)
    setConfirm({
      kind: 'comp',
      featureId: feature.featureId,
      featureSlug: feature.featureSlug,
      tierId: tier.tierId,
      tierLabel: tier.displayName,
      note: compState.note.trim(),
    })
  }

  function fireConfirm() {
    if (!confirm) return
    startTransition(async () => {
      const result =
        confirm.kind === 'grant'
          ? await grantCreditsAction(memberUserId, confirm.credits, confirm.note)
          : await compMonthAction(memberUserId, confirm.featureId, confirm.tierId, confirm.note)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setConfirm(null)
      showToast(confirm.kind === 'grant' ? `Granted ${confirm.credits} credits.` : `Comped ${confirm.featureSlug}.`)
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl border border-border-default bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Grant &amp; comp</span>
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/30">Immediate — no member approval</span>
      </div>

      <div className="mb-4 flex items-center gap-6 rounded-lg border border-border-default bg-black px-3 py-2.5">
        <div>
          <div className="text-[11.5px] text-white/40">Wallet balance</div>
          <div className="font-display text-lg font-bold tabular-nums text-white">{context.walletBalance} cr</div>
        </div>
        <div>
          <div className="text-[11.5px] text-white/40">Available (§7)</div>
          <div className="font-display text-lg font-bold tabular-nums text-white">{context.availableBalance} cr</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" className={btnPrimary} onClick={openGrant}>
          Grant credits
        </button>
        <button type="button" className={btnOutline} onClick={openComp} disabled={catalog.length === 0}>
          Comp a month
        </button>
      </div>

      {recentActions.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11.5px] font-semibold text-white/40">Recent grants &amp; comps</div>
          <div className="space-y-1.5">
            {recentActions.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-border-default bg-black px-2.5 py-1.5 text-[12px]">
                <span className="text-white/70">
                  {ACTION_LABEL[a.action]}
                  {a.note ? ` — ${a.note}` : ''}
                </span>
                <span className="text-white/30">
                  {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {a.adminName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grant credits — amount + reason, live dollar-equivalent as the admin types */}
      <Modal open={grantOpen} onClose={() => setGrantOpen(false)}>
        <h2 className="text-lg font-semibold text-white mb-1">Grant credits</h2>
        <p className="text-sm text-white/60 mb-4">
          Immediate — no cart, no member approval. Use the reason field to distinguish a promo, goodwill gesture, or correction.
        </p>
        {error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{error}</div>}
        <div className="flex flex-col gap-3 mb-4">
          <label className="text-xs text-white/60">
            Credits
            <input
              type="number"
              min={1}
              step={1}
              className="mt-1 w-full rounded-md border border-border-default bg-black px-3 py-2 text-sm text-white"
              value={grantState?.credits ?? ''}
              onChange={(e) => setGrantState((prev) => (prev ? { ...prev, credits: e.target.value } : prev))}
            />
            {grantState && Number(grantState.credits) > 0 && (
              <span className="mt-1 block text-[11.5px] text-gold">
                = {formatCents(Number(grantState.credits) * CREDIT_DOLLARS_PER_CREDIT_CENTS)} OP-borne value
              </span>
            )}
          </label>
          <label className="text-xs text-white/60">
            Reason
            <input
              type="text"
              placeholder="e.g. promo, goodwill for support issue, billing correction"
              className="mt-1 w-full rounded-md border border-border-default bg-black px-3 py-2 text-sm text-white"
              value={grantState?.note ?? ''}
              onChange={(e) => setGrantState((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
            />
          </label>
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className={btnQuiet} onClick={() => setGrantOpen(false)}>
            Never mind
          </button>
          <button type="button" className={btnPrimary} onClick={reviewGrant}>
            Review grant
          </button>
        </div>
      </Modal>

      {/* Comp a month — built to compFreeMonth's actual signature: feature + tier */}
      <Modal open={compOpen} onClose={() => setCompOpen(false)}>
        <h2 className="text-lg font-semibold text-white mb-1">Comp a month</h2>
        <p className="text-sm text-white/60 mb-4">Immediate — lands the tier directly, no Stripe, no member approval.</p>
        {error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{error}</div>}
        {catalog.length === 0 ? (
          <p className="text-sm text-white/40 mb-4">No subscribable features available.</p>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            <label className="text-xs text-white/60">
              Feature
              <select
                className="mt-1 w-full rounded-md border border-border-default bg-black px-3 py-2 text-sm text-white"
                value={compState?.featureId ?? ''}
                onChange={(e) => {
                  const feature = catalog.find((f) => f.featureId === e.target.value)
                  setCompState(feature ? { featureId: feature.featureId, tierId: feature.tiers[0]?.tierId ?? '', note: compState?.note ?? '' } : null)
                }}
              >
                {catalog.map((f) => (
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
                value={compState?.tierId ?? ''}
                onChange={(e) => setCompState((prev) => (prev ? { ...prev, tierId: e.target.value } : prev))}
              >
                {catalog
                  .find((f) => f.featureId === compState?.featureId)
                  ?.tiers.map((t) => (
                    <option key={t.tierId} value={t.tierId}>
                      {t.displayName} — {formatCents(t.priceCents)}/mo value
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-white/60">
              Reason (optional)
              <input
                type="text"
                placeholder="e.g. VIP comp, launch promo"
                className="mt-1 w-full rounded-md border border-border-default bg-black px-3 py-2 text-sm text-white"
                value={compState?.note ?? ''}
                onChange={(e) => setCompState((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
              />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className={btnQuiet} onClick={() => setCompOpen(false)}>
            Never mind
          </button>
          <button type="button" className={btnPrimary} disabled={!compState?.tierId} onClick={reviewComp}>
            Review comp
          </button>
        </div>
      </Modal>

      {/* Confirm — states the consequence in plain terms before either write fires. */}
      <Modal open={confirm !== null} onClose={() => setConfirm(null)}>
        {confirm && (
          <>
            <h2 className="text-lg font-semibold text-white mb-1">Confirm — this executes immediately</h2>
            {error && <div className="rounded-lg border border-red bg-red/10 text-red text-sm p-3 mb-4">{error}</div>}
            <div className="rounded-lg border border-gold bg-gold/5 p-3 mb-4 text-sm text-white/80 leading-relaxed">
              {confirm.kind === 'grant' ? (
                <>
                  Grant <b>{confirm.credits} credits</b> ({formatCents(confirm.credits * CREDIT_DOLLARS_PER_CREDIT_CENTS)} OP-borne value)
                  to <b>{memberName}</b>. Immediate, no member approval.
                  {confirm.note && <div className="mt-1 text-white/60">Reason: {confirm.note}</div>}
                </>
              ) : (
                <>
                  Comp <b>{confirm.featureSlug}</b> at <b>{confirm.tierLabel}</b> for <b>{memberName}</b>. Immediate, no member
                  approval, no charge.
                  {confirm.note && <div className="mt-1 text-white/60">Reason: {confirm.note}</div>}
                </>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className={btnQuiet} onClick={() => setConfirm(null)}>
                Never mind
              </button>
              <button type="button" className={btnPrimary} disabled={isPending} onClick={fireConfirm}>
                {isPending ? 'Executing…' : 'Confirm — execute now'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 z-30 rounded-lg bg-surface border border-gold px-4 py-3 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  )
}
