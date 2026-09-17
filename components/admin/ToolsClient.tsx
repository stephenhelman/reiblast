'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AdminToolsData, ToolRow } from '@/lib/adminTools'
import type { Lens } from '@/lib/adminDashboard'
import type { RangeKey, SourceFilter } from '@/lib/adminFilters'
import FiltersBar from '@/components/admin/FiltersBar'
import { formatCents } from '@/lib/money'

const LENSES: { key: Lens; label: string }[] = [
  { key: 'money', label: 'Money' },
  { key: 'users', label: 'Users' },
  { key: 'activity', label: 'Activity' },
]

const LEADERBOARD_LABEL: Record<Lens, string> = {
  money: 'Top members · by spend',
  users: 'Top members · by subscriptions',
  activity: 'Top members · by uses',
}

const LEADERBOARD_UNIT: Record<Lens, string> = {
  money: 'vendor cost',
  users: 'subscriptions',
  activity: 'tool uses',
}

type SeriesDef = { key: 'cost' | 'rev' | 'margin' | 'active' | 'unique' | 'churned' | 'ok' | 'fail' | 'partial'; label: string; className: string; stroke: string }

const SERIES_BY_LENS: Record<Lens, SeriesDef[]> = {
  money: [
    { key: 'cost', label: 'Cost', className: 'text-red', stroke: 'var(--color-red, #f0464b)' },
    { key: 'rev', label: 'Revenue', className: 'text-green', stroke: 'var(--color-green, #3fb950)' },
    { key: 'margin', label: 'Margin', className: 'text-gold', stroke: 'var(--color-gold, #f5c842)' },
  ],
  users: [
    { key: 'active', label: 'Active subs', className: 'text-blue-400', stroke: '#4a9eff' },
    { key: 'unique', label: 'Subscribers', className: 'text-green', stroke: 'var(--color-green, #3fb950)' },
    { key: 'churned', label: 'Churned', className: 'text-red', stroke: 'var(--color-red, #f0464b)' },
  ],
  activity: [
    { key: 'ok', label: 'Successful', className: 'text-green', stroke: 'var(--color-green, #3fb950)' },
    { key: 'fail', label: 'Failed', className: 'text-red', stroke: 'var(--color-red, #f0464b)' },
    { key: 'partial', label: 'Partial', className: 'text-gold', stroke: 'var(--color-gold, #f5c842)' },
  ],
}

function seriesValue(point: ToolRow['series'][number], lens: Lens, key: SeriesDef['key']): number {
  if (lens === 'money') return (point.money as Record<string, number>)[key]
  if (lens === 'users') return (point.users as Record<string, number>)[key]
  return (point.activity as Record<string, number>)[key]
}

function totalValue(tool: ToolRow, lens: Lens, key: SeriesDef['key']): number {
  if (lens === 'money') return (tool.totals.money as Record<string, number>)[key]
  if (lens === 'users') return (tool.totals.users as Record<string, number>)[key]
  return (tool.totals.activity as Record<string, number>)[key]
}

function formatValue(lens: Lens, key: SeriesDef['key'], value: number): string {
  if (lens === 'money') return formatCents(value)
  return value.toLocaleString()
}

function LineChart({ tool, lens, hidden }: { tool: ToolRow; lens: Lens; hidden: Record<string, boolean> }) {
  const series = SERIES_BY_LENS[lens]
  const W = 1000
  const H = 220
  const pad = 10
  const days = tool.series
  const n = days.length

  let max = 0
  for (const s of series) {
    if (hidden[s.key]) continue
    for (const p of days) max = Math.max(max, seriesValue(p, lens, s.key))
  }
  max = max * 1.15 || 1

  function pathFor(key: SeriesDef['key']) {
    if (n < 2) return ''
    return days
      .map((p, i) => {
        const x = pad + (i / (n - 1)) * (W - pad * 2)
        const v = seriesValue(p, lens, key)
        const y = H - 10 - (v / max) * (H - 20)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const gridLines = [0, 1, 2, 3].map((i) => 10 + (i * (H - 20)) / 3)

  return (
    <div className="h-[220px] w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {gridLines.map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {series.map((s) =>
          hidden[s.key] ? null : (
            <polyline
              key={s.key}
              points={pathFor(s.key)}
              fill="none"
              stroke={s.stroke}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
    </div>
  )
}

function Legend({
  tool,
  lens,
  hidden,
  onToggle,
  stopPropagation,
}: {
  tool: ToolRow
  lens: Lens
  hidden: Record<string, boolean>
  onToggle: (key: string) => void
  stopPropagation: boolean
}) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-4">
      {SERIES_BY_LENS[lens].map((s) => {
        const off = !!hidden[s.key]
        return (
          <span
            key={s.key}
            role={stopPropagation ? 'button' : undefined}
            onClick={(e) => {
              if (stopPropagation) {
                e.stopPropagation()
                onToggle(s.key)
              }
            }}
            className={`flex items-center gap-1.5 text-[11.5px] ${stopPropagation ? 'cursor-pointer' : ''} ${off ? 'opacity-35' : 'text-white/60'}`}
          >
            <span className="h-[3px] w-2.5 rounded-sm" style={{ background: off ? '#6b7178' : s.stroke }} />
            {s.label}
            <span className="ml-0.5 font-bold tabular-nums text-white">
              {off ? '—' : formatValue(lens, s.key, totalValue(tool, lens, s.key))}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export default function ToolsClient({
  data,
  range,
  source,
}: {
  data: AdminToolsData
  range: RangeKey
  source: SourceFilter
}) {
  const [lens, setLens] = useState<Lens>('money')
  const [leaderboardOpen, setLeaderboardOpen] = useState(true)
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({})
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, Record<string, boolean>>>({})

  function toggleTool(slug: string) {
    setOpenTools((prev) => ({ ...prev, [slug]: !prev[slug] }))
  }

  function toggleSeriesFor(slug: string, key: string) {
    setHiddenSeries((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], [key]: !prev[slug]?.[key] },
    }))
  }

  const leaderboard = data.leaderboards[lens]

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

      {/* Leaderboard accordion — default open */}
      <div className="mb-3 overflow-hidden rounded-xl border border-border-default bg-surface" data-testid="leaderboard-acc">
        <div
          className="flex cursor-pointer items-center gap-3.5 px-5 py-4 hover:bg-white/[0.02]"
          onClick={() => setLeaderboardOpen((v) => !v)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-4 w-4 flex-none text-white/40 transition-transform ${leaderboardOpen ? 'rotate-90' : ''}`}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span className="text-sm font-semibold text-white">{LEADERBOARD_LABEL[lens]}</span>
        </div>
        {leaderboardOpen && (
          <div className="px-3 pb-2">
            {leaderboard.length === 0 ? (
              <p className="px-3 pb-3 text-sm text-white/40">No data in this window.</p>
            ) : (
              leaderboard.map((row, i) => (
                <div key={row.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-3.5 rounded-lg px-3.5 py-2.75 hover:bg-white/[0.03]">
                  <div className={`text-center text-sm font-bold ${i === 0 ? 'text-gold-hover' : 'text-white/40'}`}>{i + 1}</div>
                  <div>
                    <div className="text-sm font-semibold text-white">{row.name}</div>
                    <div className="text-[11.5px] text-white/40">{row.locationId}</div>
                  </div>
                  <div className="text-right text-base font-bold tabular-nums text-white">
                    {lens === 'money' ? formatCents(row.value) : row.value.toLocaleString()}
                    <span className="block text-[11px] font-normal text-white/40">{LEADERBOARD_UNIT[lens]}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="my-6 flex items-center gap-2.5 text-xs uppercase tracking-wide text-white/40">
        Per-tool trends
        <span className="h-px flex-1 bg-border-default" />
      </div>

      {/* Per-tool trend rows — default collapsed */}
      <div className="flex flex-col gap-3" data-testid="tool-rows">
        {data.tools.map((tool) => {
          const isOpen = !!openTools[tool.slug] && tool.live
          const hidden = hiddenSeries[tool.slug] ?? {}
          return (
            <div key={tool.slug} className="overflow-hidden rounded-xl border border-border-default bg-surface" data-testid={`tool-row-${tool.slug}`}>
              <div
                className={`flex items-center gap-3.5 px-5 py-4 ${tool.live ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
                onClick={tool.live ? () => toggleTool(tool.slug) : undefined}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`h-4 w-4 flex-none text-white/40 transition-transform ${isOpen ? 'rotate-90' : ''} ${!tool.live ? 'opacity-25' : ''}`}
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <div className="flex items-center gap-2.5">
                  <img src={tool.wordmark} alt={tool.name} className="h-4.5 w-auto" />
                  <span
                    className={`rounded-md px-1.75 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      tool.live ? 'bg-green/10 text-green' : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {tool.live ? 'Live' : 'Soon'}
                  </span>
                </div>
                {tool.live ? (
                  <Legend tool={tool} lens={lens} hidden={hidden} onToggle={(k) => toggleSeriesFor(tool.slug, k)} stopPropagation={isOpen} />
                ) : (
                  <span className="ml-auto text-[11.5px] text-white/40">Not launched</span>
                )}
              </div>
              {isOpen && (
                <div className="px-5 pb-4.5">
                  <div className="mb-2 flex justify-end">
                    <Link
                      href={`/admin/tools/${tool.slug}`}
                      className="flex items-center gap-1 text-[11.5px] text-white/40 hover:text-gold-hover"
                    >
                      Full breakdown
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </Link>
                  </div>
                  <LineChart tool={tool} lens={lens} hidden={hidden} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-8 border-t border-border-default pt-4 text-[11.5px] leading-relaxed text-white/40">
        <b className="text-white/60">acq</b> and <b className="text-white/60">dispo</b> render as separate rows — admin
        sees the two bots individually. Client-only lines here; the admin/client split lives on each tool&apos;s deep
        page. Revenue is estimated (list price) until Stripe is wired; Rentcast cost is amortized read-side from the
        vendor&apos;s billing plan, not a per-call sum.
      </p>
    </div>
  )
}
