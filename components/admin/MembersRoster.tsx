'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatCents } from '@/lib/money'
import type { MemberFlag, MemberRow } from '@/lib/adminMembersList'

const FLAG_LABEL: Record<MemberFlag, string> = {
  past_due: 'Payment needs fixing',
  neg_bal: 'Negative balance',
  upsell: 'Upsell candidates',
  downsell: 'Churn risk · save',
}

const QUEUE_CARDS: { flag: MemberFlag; label: string; sub: string; theme: string }[] = [
  {
    flag: 'past_due',
    label: 'Payment needs fixing',
    sub: 'Past-due or suspended — recover before they lapse',
    theme: 'border-red/30 bg-red/5 text-red',
  },
  {
    flag: 'neg_bal',
    label: 'Negative balance',
    sub: 'Credits below zero — money leak, investigate',
    theme: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
  },
  {
    flag: 'upsell',
    label: 'Upsell candidates',
    sub: 'Heavy credit use — a plan would cost them less',
    theme: 'border-green/30 bg-green/5 text-green',
  },
  {
    flag: 'downsell',
    label: 'Churn risk · save',
    sub: 'Paying, using <25% of allowance — downgrade beats cancel',
    theme: 'border-blue-400/30 bg-blue-400/5 text-blue-400',
  },
]

const BUNDLE_LABEL: Record<string, string> = { 'bundle-plus': 'Bundle Plus', 'bundle-pro': 'Bundle Pro' }
const STATUS_CLASS: Record<MemberRow['status'], string> = {
  active: 'text-green bg-green/10',
  past_due: 'text-red bg-red/10',
  suspended: 'text-amber-400 bg-amber-500/10',
  canceled: 'text-white/40 bg-white/5',
}
const FIT_LABEL: Record<MemberRow['planFit'], string> = { upsell: 'Upsell', downsell: 'Underusing', healthy: 'Healthy' }
const FIT_CLASS: Record<MemberRow['planFit'], string> = {
  upsell: 'text-green',
  downsell: 'text-amber-400',
  healthy: 'text-white/40',
}

type SortKey = 'name' | 'bal' | 'fit' | 'margin' | 'status'

const FIT_ORDER: Record<MemberRow['planFit'], number> = { upsell: 0, downsell: 1, healthy: 2 }
const STATUS_ORDER: Record<MemberRow['status'], number> = { past_due: 0, suspended: 1, active: 2, canceled: 3 }

export default function MembersRoster({ rows, counts }: { rows: MemberRow[]; counts: Record<MemberFlag, number> }) {
  const [filter, setFilter] = useState<MemberFlag | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })

  function toggleFilter(flag: MemberFlag) {
    setFilter((prev) => (prev === flag ? null : flag))
  }

  function sortBy(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  const visibleRows = useMemo(() => {
    const filtered = filter ? rows.filter((m) => m.flags.includes(filter)) : rows
    const sorted = [...filtered].sort((a, b) => {
      let x: number | string
      let y: number | string
      switch (sort.key) {
        case 'name':
          x = a.name
          y = b.name
          break
        case 'bal':
          x = a.walletBalance
          y = b.walletBalance
          break
        case 'margin':
          x = a.marginCents
          y = b.marginCents
          break
        case 'fit':
          x = FIT_ORDER[a.planFit]
          y = FIT_ORDER[b.planFit]
          break
        case 'status':
          x = STATUS_ORDER[a.status]
          y = STATUS_ORDER[b.status]
          break
      }
      if (x < y) return -1 * sort.dir
      if (x > y) return 1 * sort.dir
      return 0
    })
    return sorted
  }, [rows, filter, sort])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3.5">
        {QUEUE_CARDS.map((card) => (
          <button
            key={card.flag}
            type="button"
            onClick={() => toggleFilter(card.flag)}
            className={`rounded-2xl border p-4.5 text-left transition-colors ${
              filter === card.flag ? card.theme : 'border-border-default bg-surface hover:border-white/20'
            }`}
          >
            <div className={`font-display text-3xl font-bold tabular-nums ${filter === card.flag ? '' : 'text-white'}`}>
              {counts[card.flag]}
            </div>
            <div className="mt-1 text-xs font-semibold text-white">{card.label}</div>
            <div className="mt-1 text-[11.5px] leading-snug text-white/40">{card.sub}</div>
          </button>
        ))}
      </div>

      <div className="flex min-h-[24px] items-center gap-3">
        {filter && (
          <div className="flex items-center gap-2 text-xs text-gold">
            <span>Filtered: {FLAG_LABEL[filter]}</span>
            <span>·</span>
            <button type="button" onClick={() => setFilter(null)} className="text-white/40 underline hover:text-white/70">
              clear
            </button>
          </div>
        )}
        <div className="ml-auto text-xs text-white/40">
          {visibleRows.length} of {rows.length} members
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border-default bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-default text-[11px] uppercase tracking-wide text-white/40">
              <Th onClick={() => sortBy('name')}>Member</Th>
              <th className="p-4 font-semibold">Subscriptions</th>
              <Th align="right" onClick={() => sortBy('bal')}>Balance</Th>
              <Th onClick={() => sortBy('fit')}>Plan fit</Th>
              <Th align="right" onClick={() => sortBy('margin')}>Margin</Th>
              <Th onClick={() => sortBy('status')}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-white/40">
                  No members match this filter.
                </td>
              </tr>
            )}
            {visibleRows.map((m) => (
              <tr key={m.id} className="border-b border-border-default last:border-0 hover:bg-black/40">
                <td className="p-4">
                  <Link href={`/admin/members/${m.id}`} className="block">
                    <div className="font-semibold text-white hover:text-gold">{m.name}</div>
                    <div className="text-[11.5px] text-white/40">{m.locationId}</div>
                  </Link>
                </td>
                <td className="p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {m.subs.map((s) => (
                      <span key={s.featureSlug} className="rounded-md border border-border-default bg-black px-2 py-0.5 text-[10.5px] font-semibold text-white/70">
                        {s.displayName}
                      </span>
                    ))}
                    {m.bundleSlug && (
                      <span className="rounded-md border border-gold-hover/60 bg-gold/10 px-2 py-0.5 text-[10.5px] font-semibold text-gold">
                        {BUNDLE_LABEL[m.bundleSlug]}
                      </span>
                    )}
                  </div>
                </td>
                <td className={`p-4 text-right tabular-nums ${m.walletBalance < 0 ? 'font-semibold text-red' : 'text-white/70'}`}>
                  {m.walletBalance} <span className="text-[11px] text-white/40">cr</span>
                </td>
                <td className="p-4">
                  <span className={`inline-flex items-center gap-1.5 text-xs ${FIT_CLASS[m.planFit]}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {FIT_LABEL[m.planFit]}
                  </span>
                </td>
                <td className={`p-4 text-right tabular-nums ${m.marginCents < 0 ? 'text-red' : 'text-green'}`}>{formatCents(m.marginCents)}</td>
                <td className="p-4">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CLASS[m.status]}`}>
                    {m.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, onClick, align }: { children: React.ReactNode; onClick: () => void; align?: 'right' }) {
  return (
    <th onClick={onClick} className={`cursor-pointer select-none p-4 font-semibold hover:text-white/70 ${align === 'right' ? 'text-right' : ''}`}>
      {children} <span className="ml-0.5 opacity-50">↕</span>
    </th>
  )
}
