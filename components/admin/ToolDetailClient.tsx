'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { ToolDetailData, ToolTrendPoint } from '@/lib/adminToolDetail'
import type { Lens } from '@/lib/adminDashboard'
import FiltersBar from '@/components/admin/FiltersBar'
import { formatCents } from '@/lib/money'
import { formatCentsOrDash } from '@/components/admin/money'
import { RANGE_LABELS, type RangeKey } from '@/lib/adminFilters'

const RANGE_OPTIONS = Object.keys(RANGE_LABELS) as RangeKey[]

const LENSES: { key: Lens; label: string }[] = [
  { key: 'money', label: 'Money' },
  { key: 'users', label: 'Users' },
  { key: 'activity', label: 'Activity' },
]

const LEADERBOARD_LABEL: Record<Lens, string> = {
  money: 'by spend',
  users: 'by tier',
  activity: 'by uses',
}

type SeriesDef = { key: 'cost' | 'rev' | 'margin' | 'active' | 'unique' | 'churned' | 'ok' | 'fail' | 'partial'; label: string; stroke: string }

const SERIES_BY_LENS: Record<Lens, SeriesDef[]> = {
  money: [
    { key: 'cost', label: 'Cost', stroke: 'var(--color-red, #f0464b)' },
    { key: 'rev', label: 'Revenue (recognized)', stroke: 'var(--color-green, #3fb950)' },
    { key: 'margin', label: 'Margin', stroke: 'var(--color-gold, #f5c842)' },
  ],
  users: [
    { key: 'active', label: 'Active subs', stroke: '#4a9eff' },
    { key: 'unique', label: 'Subscribers', stroke: 'var(--color-green, #3fb950)' },
    { key: 'churned', label: 'Churned', stroke: 'var(--color-red, #f0464b)' },
  ],
  activity: [
    { key: 'ok', label: 'Successful', stroke: 'var(--color-green, #3fb950)' },
    { key: 'fail', label: 'Failed', stroke: 'var(--color-red, #f0464b)' },
    { key: 'partial', label: 'Partial', stroke: 'var(--color-gold, #f5c842)' },
  ],
}

function clientValue(p: ToolTrendPoint, lens: Lens, key: SeriesDef['key']): number {
  if (lens === 'money') return (p.moneyClient as Record<string, number>)[key]
  if (lens === 'users') return (p.users as Record<string, number>)[key]
  return (p.activityClient as Record<string, number>)[key]
}

function adminValue(p: ToolTrendPoint, lens: Lens, key: SeriesDef['key']): number {
  if (lens === 'money') return (p.moneyAdmin as Record<string, number>)[key]
  if (lens === 'users') return 0
  return (p.activityAdmin as Record<string, number>)[key]
}

function formatValue(lens: Lens, value: number): string {
  if (lens === 'money') return formatCents(value)
  return value.toLocaleString()
}

function totalFor(data: ToolDetailData, lens: Lens, key: SeriesDef['key']): number {
  return data.series.reduce((s, p) => s + clientValue(p, lens, key) + adminValue(p, lens, key), 0)
}

function MainChart({
  data,
  lens,
  hidden,
  source,
  isMember,
}: {
  data: ToolDetailData
  lens: Lens
  hidden: Record<string, boolean>
  source: string
  isMember: boolean
}) {
  const series = SERIES_BY_LENS[lens]
  const W = 1000
  const H = 260
  const pad = 10
  const points = data.series
  const n = points.length

  const showClient = isMember || source !== 'admin'
  const showAdmin = !isMember && source !== 'client'

  let max = 0
  for (const s of series) {
    if (hidden[s.key]) continue
    for (const p of points) {
      if (showClient) max = Math.max(max, clientValue(p, lens, s.key))
      if (showAdmin) max = Math.max(max, adminValue(p, lens, s.key))
    }
  }
  max = max * 1.15 || 1

  function pathFor(key: SeriesDef['key'], getter: (p: ToolTrendPoint) => number) {
    if (n < 2) return ''
    return points
      .map((p, i) => {
        const x = pad + (i / (n - 1)) * (W - pad * 2)
        const v = getter(p)
        const y = H - 10 - (v / max) * (H - 20)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const gridLines = [0, 1, 2, 3].map((i) => 10 + (i * (H - 20)) / 3)

  return (
    <div className="h-[260px] w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {gridLines.map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {series.map((s) => {
          if (hidden[s.key]) return null
          return (
            <g key={s.key}>
              {showClient && (
                <polyline points={pathFor(s.key, (p) => clientValue(p, lens, s.key))} fill="none" stroke={s.stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {showAdmin && (
                <polyline
                  points={pathFor(s.key, (p) => adminValue(p, lens, s.key))}
                  fill="none"
                  stroke={s.stroke}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  opacity={0.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function ToolDetailClient({ data }: { data: ToolDetailData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [lens, setLens] = useState<Lens>('money')
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const isMember = !!data.member

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null) params.delete(k)
      else params.set(k, v)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function selectMember(userId: string) {
    setSearch('')
    setSearchOpen(false)
    // A single-member view has no admin/client dimension of its own — Source resets to "both".
    pushParams({ member: userId, source: null })
  }

  function clearMember() {
    pushParams({ member: null })
  }

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return data.members.slice(0, 8)
    const q = search.toLowerCase()
    return data.members.filter((m) => m.name.toLowerCase().includes(q) || m.locationId.toLowerCase().includes(q)).slice(0, 8)
  }, [search, data.members])

  const heroCards = useMemo(() => {
    if (lens === 'money') {
      const m = data.hero.money
      return [
        { label: 'Subscription revenue', dotClass: 'bg-blue-400', value: formatCents(m.subRevenueCents), sub: m.subRevenueEstimated ? 'estimated (list) · Stripe at wire' : 'Stripe · recurring' },
        { label: 'Credit revenue', dotClass: 'bg-green', value: formatCents(m.creditRevenueCents), sub: `credit uses × ${m.creditsPerUse} × $0.25` },
        { label: 'Vendor cost', dotClass: 'bg-red', value: formatCents(m.vendorCostCents), sub: m.costUnknownCalls > 0 ? `API calls + Rentcast · ${m.costUnknownCalls} cost-unknown` : 'API calls + Rentcast' },
        { label: 'Margin', dotClass: 'bg-gold', value: formatCents(m.marginCents), sub: 'sub rev + credit rev − vendor cost', accent: true },
      ]
    }
    if (lens === 'users') {
      const u = data.hero.users
      return [
        { label: 'Active subscriptions', dotClass: 'bg-blue-400', value: u.active.toLocaleString(), sub: 'on this tool' },
        { label: 'Unique subscribers', dotClass: 'bg-green', value: u.unique.toLocaleString(), sub: 'distinct members', accent: true },
        { label: 'Churned', dotClass: 'bg-red', value: u.churned.toLocaleString(), sub: 'cancelled / inactive' },
      ]
    }
    const a = data.hero.activity
    return [
      { label: 'Successful', dotClass: 'bg-green', value: a.ok.toLocaleString(), sub: 'completed runs', accent: true },
      { label: 'Failed', dotClass: 'bg-red', value: a.fail.toLocaleString(), sub: 'errored' },
      { label: 'Partial', dotClass: 'bg-gold', value: a.partial.toLocaleString(), sub: 'some output' },
    ]
  }, [lens, data])

  const fitTotal = data.allowanceFit.allowanceCovered + data.allowanceFit.creditCovered
  const fitPct = fitTotal > 0 ? Math.round((data.allowanceFit.allowanceCovered / fitTotal) * 100) : null

  const source = data.source

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs text-white/40">
        <Link href="/admin" className="hover:text-gold-hover">Admin</Link>
        <span>›</span>
        <Link href="/admin/tools" className="hover:text-gold-hover">Tools</Link>
        <span>›</span>
        <span className="text-white/70">{data.name}</span>
      </div>

      {/* Page head */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={data.wordmark} alt={data.name} className="h-7 w-auto" />
          <span className={`rounded-md px-2 py-0.75 text-[10.5px] font-semibold uppercase tracking-wide ${data.live ? 'bg-green/10 text-green' : 'bg-white/10 text-white/40'}`}>
            {data.live ? 'Live' : 'Soon'}
          </span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-white">{data.glance.totalRuns.toLocaleString()}</div>
            <div className="text-[10.5px] uppercase tracking-wide text-white/40">total runs</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-white">{data.glance.allowanceCoveredRuns.toLocaleString()}</div>
            <div className="text-[10.5px] uppercase tracking-wide text-white/40">allowance-covered</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-white">{data.glance.creditRuns.toLocaleString()}</div>
            <div className="text-[10.5px] uppercase tracking-wide text-white/40">credit runs</div>
          </div>
        </div>
      </div>

      {/* Member search / viewing banner */}
      <div className="mb-5">
        {isMember ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-gold-hover bg-surface px-5 py-3.5">
            <div className="text-sm">
              <span className="text-white/40">Viewing</span> <span className="font-semibold text-white">{data.member!.name}</span>{' '}
              <span className="text-white/40">· {data.member!.locationId}</span>
            </div>
            <button type="button" onClick={clearMember} className="text-xs font-semibold text-white/50 hover:text-gold-hover">
              Clear ✕
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search a member to view their usage…"
              className="w-full max-w-md rounded-lg border border-border-default bg-surface px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-gold-hover focus:outline-none"
            />
            {searchOpen && filteredMembers.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-w-md overflow-hidden rounded-lg border border-border-default bg-surface shadow-xl">
                {filteredMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={() => selectMember(m.id)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                  >
                    <span>{m.name}</span>
                    <span className="text-xs text-white/40">{m.locationId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl border border-border-default bg-surface p-1" data-testid="lens-toggle">
          {LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => {
                setLens(l.key)
                setHidden({})
              }}
              data-lens={l.key}
              className={`rounded-lg px-4.5 py-2 text-sm font-semibold transition-colors ${lens === l.key ? 'bg-linear-to-b from-gold-hover to-gold text-black' : 'text-white/50 hover:text-white'}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        {/* Source filter hides in single-member view — a client has no admin/client dimension */}
        <FiltersBarNoSource range={data.range} source={source} hideSource={isMember} pushParams={pushParams} />
      </div>

      {/* Hero */}
      <div className={`mb-4 grid grid-cols-1 gap-4 ${heroCards.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {heroCards.map((c) => (
          <div key={c.label} className={`rounded-xl border bg-surface p-5 ${c.accent ? 'border-gold-hover' : 'border-border-default'}`}>
            <div className="mb-3 flex items-center gap-2 text-xs text-white/50">
              <span className={`h-2 w-2 rounded-full ${c.dotClass}`} />
              {c.label}
            </div>
            <div className={`text-[28px] font-bold leading-none tabular-nums ${c.accent ? 'text-gold' : 'text-white'}`}>{c.value}</div>
            <p className="mt-2 text-xs text-white/40">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Main chart */}
      <div className="mb-4 rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/50">
            Trend · <span className="normal-case tracking-normal text-white/70">{lens[0].toUpperCase() + lens.slice(1)}</span>
          </span>
          {!isMember && source === 'both' && (
            <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10.5px] text-white/40">solid = client · dashed = admin</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-4">
            {SERIES_BY_LENS[lens].map((s) => {
              const off = !!hidden[s.key]
              return (
                <span
                  key={s.key}
                  role="button"
                  onClick={() => setHidden((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
                  className={`flex cursor-pointer items-center gap-1.5 text-[11.5px] ${off ? 'opacity-35' : 'text-white/60'}`}
                >
                  <span className="h-[3px] w-2.5 rounded-sm" style={{ background: off ? '#6b7178' : s.stroke }} />
                  {s.label}
                  <span className="ml-0.5 font-bold tabular-nums text-white">{off ? '—' : formatValue(lens, totalFor(data, lens, s.key))}</span>
                </span>
              )
            })}
          </div>
        </div>
        <MainChart data={data} lens={lens} hidden={hidden} source={source} isMember={isMember} />
        {lens === 'money' && (
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            Revenue here is usage-recognized (allowance-covered runs × per-use plan value, plus credit runs × $0.25) so it moves with
            usage — it&apos;s a different number from the flat billed Stripe total on the Subscription revenue card above.
          </p>
        )}
      </div>

      {/* Vendor breakdown */}
      <div className="mb-4 rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Vendor breakdown</span>
          <span className="text-[11px] text-white/40">from API calls only · not tool uses (caching means calls ≠ uses)</span>
        </div>
        {data.vendorCards.length === 0 ? (
          <p className="text-sm text-white/40">No vendor calls in this window.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {data.vendorCards.map((v) => (
              <div key={v.resource} className="rounded-lg border border-border-default bg-black p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold capitalize text-white">{v.resource}</span>
                  <span className="rounded-md bg-white/5 px-1.75 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                    {v.rentcastMath ? 'subscription plan' : 'per-call rate'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-base font-bold tabular-nums text-white">{v.calls.toLocaleString()}</div>
                    <div className="text-[10.5px] text-white/40">calls</div>
                  </div>
                  <div>
                    <div className="text-base font-bold tabular-nums text-white">{formatCentsOrDash(v.costCents)}</div>
                    <div className="text-[10.5px] text-white/40">{v.rentcastMath ? 'cost (derived)' : 'cost'}</div>
                  </div>
                  <div>
                    <div className="text-base font-bold tabular-nums text-white">{v.thirdStat.value}</div>
                    <div className="text-[10.5px] text-white/40">{v.thirdStat.label}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Allowance vs credit */}
      <div className="mb-4 rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Allowance vs credit usage</span>
          <span className="text-[11px] text-white/40">plan-fit signal · not revenue</span>
        </div>
        <div className="flex flex-col gap-3">
          <AllowanceChart data={data} />
          <p className="border-t border-border-default pt-3 text-[11.5px] leading-relaxed text-white/50">
            {fitPct !== null ? (
              <>
                {isMember ? (
                  <>
                    <b className="text-white/80">{data.member!.name}</b> used {data.allowanceFit.allowanceCovered} allowance-covered run
                    {data.allowanceFit.allowanceCovered === 1 ? '' : 's'} and {data.allowanceFit.creditCovered} credit run
                    {data.allowanceFit.creditCovered === 1 ? '' : 's'} in this window.
                  </>
                ) : (
                  <>
                    Across all members: <b className="text-white/80">{fitPct}% of {data.name} runs are allowance-covered</b>,{' '}
                    {100 - fitPct}% spill into credits. A rising credit share means members are outgrowing their plans — an upsell signal.
                  </>
                )}
              </>
            ) : (
              'No allowance/credit activity in this window.'
            )}
          </p>
        </div>
      </div>

      {/* Leaderboard */}
      {!isMember && (
        <div className="rounded-xl border border-border-default bg-surface p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
            Top members on {data.name} · {LEADERBOARD_LABEL[lens]}
          </div>
          {data.leaderboards[lens].length === 0 ? (
            <p className="text-sm text-white/40">No data in this window.</p>
          ) : (
            <div className="flex flex-col">
              {data.leaderboards[lens].map((row, i) => (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => selectMember(row.userId)}
                  className="grid grid-cols-[28px_1fr_auto] items-center gap-3.5 rounded-lg px-3.5 py-2.75 text-left hover:bg-white/[0.03]"
                >
                  <div className={`text-center text-sm font-bold ${i === 0 ? 'text-gold-hover' : 'text-white/40'}`}>{i + 1}</div>
                  <div>
                    <div className="text-sm font-semibold text-white">{row.name}</div>
                    <div className="text-[11.5px] text-white/40">{row.locationId}</div>
                  </div>
                  <div className="text-right text-base font-bold tabular-nums text-white">{row.displayValue}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AllowanceChart({ data }: { data: ToolDetailData }) {
  const W = 1000
  const H = 150
  const pad = 6
  const points = data.allowanceFit.series
  const n = points.length

  if (n < 2) {
    return <div className="flex h-[150px] w-full items-center justify-center text-sm text-white/30">Not enough data to chart.</div>
  }

  const pathPoints = points.map((p, i) => {
    const total = p.allowance + p.credit
    const pct = total > 0 ? (p.allowance / total) * 100 : 100
    const x = pad + (i / (n - 1)) * (W - pad * 2)
    const y = H - 6 - (pct / 100) * (H - 14)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <div className="flex flex-col gap-2">
      {/* Chart gets its own block — fixed-height wrapper, block-level SVG (no inline baseline gap) */}
      <div className="h-[150px] w-full">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full">
          {[0, 1, 2].map((i) => (
            <line key={i} x1={0} y1={8 + (i * (H - 16)) / 2} x2={W} y2={8 + (i * (H - 16)) / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          ))}
          <polygon points={`${pad},${H - 6} ${pathPoints.join(' ')} ${W - pad},${H - 6}`} fill="rgba(63,185,80,0.16)" stroke="var(--color-green, #3fb950)" strokeWidth={2} />
        </svg>
      </div>
      {/* Legend is its own row, below the chart — never inside/overlapping it */}
      <div className="flex flex-wrap gap-4 text-[11.5px] text-white/50">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-green" /> Allowance-covered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-white/30" /> Credit-covered (remainder)
        </span>
      </div>
    </div>
  )
}

/** Single-member view: Range only — the Source (admin/client) dimension has no meaning for one member's own usage, so it hides entirely rather than rendering disabled. */
function FiltersBarNoSource({
  range,
  source,
  hideSource,
  pushParams,
}: {
  range: ToolDetailData['range']
  source: ToolDetailData['source']
  hideSource: boolean
  pushParams: (next: Record<string, string | null>) => void
}) {
  if (!hideSource) return <FiltersBar range={range} source={source} />
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-white/70">
        <span className="text-[11px] uppercase tracking-wide text-white/40">Range</span>
        <select
          value={range}
          onChange={(e) => pushParams({ range: e.target.value })}
          className="cursor-pointer bg-transparent font-medium text-white focus:outline-none"
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r} value={r} className="bg-surface text-white">
              {RANGE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
