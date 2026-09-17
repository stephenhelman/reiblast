'use client'

import { useState } from 'react'
import type { AdminOverviewData, Lens } from '@/lib/adminDashboard'
import type { RangeKey, SourceFilter } from '@/lib/adminFilters'
import FiltersBar from '@/components/admin/FiltersBar'
import { formatCentsOrDash, formatCountOrDash } from '@/components/admin/money'

const LENSES: { key: Lens; label: string }[] = [
  { key: 'money', label: 'Money' },
  { key: 'users', label: 'Users' },
  { key: 'activity', label: 'Activity' },
]

type HeroCard = { label: string; dotClass: string; value: string; sub: string; accent?: boolean }

function heroCardsFor(lens: Lens, data: AdminOverviewData): HeroCard[] {
  if (lens === 'money') {
    const { heroMoney } = data
    const unknownNote = heroMoney.costUnknownCalls > 0 ? ` · ${heroMoney.costUnknownCalls} calls cost-unknown` : ''
    return [
      { label: 'Cost', dotClass: 'bg-red', value: formatCentsOrDash(heroMoney.costCents), sub: `Melissa + Anthropic + Rentcast (amortized)${unknownNote}` },
      { label: 'Revenue', dotClass: 'bg-green', value: formatCentsOrDash(heroMoney.revenueCents), sub: 'estimated (list) · from Stripe at wire', accent: true },
      { label: 'Margin', dotClass: 'bg-gold', value: formatCentsOrDash(heroMoney.marginCents), sub: 'Revenue − vendor cost' },
    ]
  }
  if (lens === 'users') {
    const { heroUsers } = data
    return [
      { label: 'Active subscriptions', dotClass: 'bg-blue-400', value: formatCountOrDash(heroUsers.active), sub: 'recurring tool-sub lines' },
      { label: 'Unique subscribers', dotClass: 'bg-green', value: formatCountOrDash(heroUsers.unique), sub: 'distinct paying members', accent: true },
      { label: 'Churned', dotClass: 'bg-red', value: formatCountOrDash(heroUsers.churned), sub: 'cancelled + inactive' },
    ]
  }
  const { heroActivity } = data
  const total = heroActivity.ok + heroActivity.fail + heroActivity.partial
  const failRate = total > 0 ? `${((heroActivity.fail / total) * 100).toFixed(1)}% fail rate` : 'no runs in window'
  return [
    { label: 'Successful', dotClass: 'bg-green', value: heroActivity.ok.toLocaleString(), sub: 'completed tool runs', accent: true },
    { label: 'Failed', dotClass: 'bg-red', value: heroActivity.fail.toLocaleString(), sub: failRate },
    { label: 'Partial', dotClass: 'bg-gold', value: heroActivity.partial.toLocaleString(), sub: 'some output produced' },
  ]
}

type CardMetric = { value: string; label: string; tone: 'pos' | 'neg' | 'gold' | 'neutral' }

function cardMetricsFor(lens: Lens, tool: AdminOverviewData['tools'][number]): CardMetric[] {
  if (lens === 'money') {
    return [
      { value: formatCentsOrDash(tool.money.costCents), label: 'Cost', tone: 'neg' },
      { value: formatCentsOrDash(tool.money.revenueCents), label: 'Revenue', tone: 'gold' },
      { value: formatCentsOrDash(tool.money.marginCents), label: 'Margin', tone: 'pos' },
    ]
  }
  if (lens === 'users') {
    return [
      { value: formatCountOrDash(tool.users.active), label: 'Active', tone: 'neutral' },
      { value: formatCountOrDash(tool.users.unique), label: 'Unique', tone: 'pos' },
      { value: formatCountOrDash(tool.users.churned), label: 'Churned', tone: 'neutral' },
    ]
  }
  return [
    { value: tool.activity.ok.toLocaleString(), label: 'Success', tone: 'pos' },
    { value: tool.activity.fail.toLocaleString(), label: 'Failed', tone: 'neg' },
    { value: tool.activity.partial.toLocaleString(), label: 'Partial', tone: 'gold' },
  ]
}

const TONE_CLASS: Record<CardMetric['tone'], string> = {
  pos: 'text-green',
  neg: 'text-red',
  gold: 'text-gold',
  neutral: 'text-white',
}

export default function OverviewClient({
  data,
  range,
  source,
}: {
  data: AdminOverviewData
  range: RangeKey
  source: SourceFilter
}) {
  // Lens toggle is pure client state over the already-loaded `data` payload —
  // switching lenses re-renders from memory, never refetches. Only
  // range/source (via FiltersBar's URL push) cause the server to re-fetch.
  const [lens, setLens] = useState<Lens>('money')

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl border border-border-default bg-surface p-1" data-testid="lens-toggle">
          {LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLens(l.key)}
              data-lens={l.key}
              className={`rounded-lg px-4.5 py-2 text-sm font-semibold transition-colors ${
                lens === l.key ? 'bg-linear-to-b from-gold-hover to-gold text-black' : 'text-white/50 hover:text-white'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <FiltersBar range={range} source={source} />
      </div>

      {/* Hero triad */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {heroCardsFor(lens, data).map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border bg-surface p-5.5 ${c.accent ? 'border-gold-hover' : 'border-border-default'}`}
          >
            <div className="mb-3.5 flex items-center gap-2 text-xs text-white/50">
              <span className={`h-2 w-2 rounded-full ${c.dotClass}`} />
              {c.label}
            </div>
            <div className={`text-[34px] font-bold leading-none tabular-nums ${c.accent ? 'text-gold' : 'text-white'}`}>
              {c.value}
            </div>
            <p className="mt-2 text-xs text-white/40">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="my-6 flex items-center gap-2.5 text-xs uppercase tracking-wide text-white/40">
        Per-tool breakdown
        <span className="h-px flex-1 bg-border-default" />
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
        {data.tools.map((tool) => (
          <div
            key={tool.slug}
            className={`rounded-xl border border-border-default bg-surface p-5 transition-colors hover:border-white/20 ${!tool.live ? 'opacity-60' : ''}`}
          >
            <div className="mb-4 flex h-6 items-center justify-between">
              <img src={tool.wordmark} alt={tool.name} className="h-5 w-auto" />
              <span
                className={`rounded-md px-2 py-0.75 text-[10.5px] font-semibold uppercase tracking-wide ${
                  tool.live ? 'bg-green/10 text-green' : 'bg-white/10 text-white/40'
                }`}
              >
                {tool.live ? 'Live' : 'Soon'}
              </span>
            </div>
            <div className={`grid grid-cols-3 gap-2 ${!tool.live ? 'grayscale' : ''}`}>
              {cardMetricsFor(lens, tool).map((m) => (
                <div key={m.label} className="flex flex-col gap-0.75">
                  <span className={`text-[19px] font-bold ${TONE_CLASS[m.tone]}`}>{m.value}</span>
                  <span className="text-[10.5px] tracking-wide text-white/40">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 border-t border-border-default pt-4 text-[11.5px] leading-relaxed text-white/40">
        <b className="text-white/60">acq</b> and <b className="text-white/60">dispo</b> render as separate cards — admin
        sees the two bots individually; members see one REIclose entitlement. Cost/usage come from ApiCall + ToolUse
        (admin-eyes); revenue is Stripe at wire, estimated (list price) here.
      </p>
    </div>
  )
}
