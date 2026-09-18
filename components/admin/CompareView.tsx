'use client'

// CLIENT-SAFE: this component renders usage-only data (runs, allowance,
// %-on-credits, avg/week) — never cost/margin/revenue. See lib/adminCompare.ts.

import { Fragment, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { CompareData, MemberSearchResult } from '@/lib/adminCompare'

const RANGE_OPTIONS = [30, 90, 180]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '').concat(parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '').toUpperCase()
}

function TrendChart({ seriesA, seriesB }: { seriesA: { runs: number }[]; seriesB: { runs: number }[] }) {
  const W = 1000
  const H = 170
  const n = Math.max(seriesA.length, seriesB.length)
  if (n < 2) return <div className="h-42.5 w-full" />
  const max = Math.max(1, ...seriesA.map((p) => p.runs), ...seriesB.map((p) => p.runs)) * 1.15

  function points(series: { runs: number }[]) {
    return series
      .map((p, i) => {
        const x = 6 + (i / (n - 1)) * (W - 12)
        const y = H - 8 - (p.runs / max) * (H - 18)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  return (
    <div className="h-42.5 w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={0} y1={8 + (i * (H - 18)) / 3} x2={W} y2={8 + (i * (H - 18)) / 3} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        <polyline points={points(seriesA)} fill="none" stroke="#4a9eff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={points(seriesB)} fill="none" stroke="#f5c842" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function MemberPicker({
  color,
  label,
  member,
  onPick,
}: {
  color: 'a' | 'b'
  label: string
  member: { id: string; name: string; locationId: string } | null
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const handle = setTimeout(async () => {
      const res = await fetch(`/admin/members/compare/search?q=${encodeURIComponent(query)}`)
      if (!res.ok) return
      const data = await res.json()
      setResults(data.results ?? [])
    }, 200)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const borderColor = color === 'a' ? 'border-blue-400/40' : 'border-gold-hover/40'
  const markBg = color === 'a' ? 'bg-blue-400' : 'bg-gold'

  return (
    <div ref={boxRef} className={`relative flex items-center gap-3.5 rounded-xl border ${borderColor} bg-surface px-4.5 py-4`}>
      {member ? (
        <>
          <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-black ${markBg}`}>{initials(member.name)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-white">{member.name}</div>
            <div className="truncate text-[11.5px] text-white/40">{member.locationId}</div>
          </div>
        </>
      ) : (
        <div className="flex-1 text-[13px] text-white/40">Member {label} — search to select</div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-auto shrink-0 text-[11.5px] font-semibold text-gold-hover hover:text-gold"
      >
        {member ? 'Change' : 'Select'}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-full rounded-xl border border-border-default bg-black p-2 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
          />
          <div className="mt-1.5 max-h-56 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onPick(r.id)
                  setOpen(false)
                  setQuery('')
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-white hover:bg-white/5"
              >
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-[11px] text-white/40">{r.locationId}</span>
              </button>
            ))}
            {query.trim() && results.length === 0 && <div className="px-2.5 py-2 text-[13px] text-white/40">No matches.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CompareView({ data, currentA, currentB, currentDays }: { data: CompareData | null; currentA: string | null; currentB: string | null; currentDays: number }) {
  const router = useRouter()
  const [view, setView] = useState<'list' | 'chart'>('list')

  function pushQuery(next: { a?: string | null; b?: string | null; days?: number }) {
    const params = new URLSearchParams()
    const a = next.a !== undefined ? next.a : currentA
    const b = next.b !== undefined ? next.b : currentB
    const days = next.days !== undefined ? next.days : currentDays
    if (a) params.set('a', a)
    if (b) params.set('b', b)
    params.set('days', String(days))
    router.push(`/admin/members/compare?${params.toString()}`)
  }

  return (
    <div>
      <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <MemberPicker color="a" label="A" member={data?.memberA ?? null} onPick={(id) => pushQuery({ a: id })} />
        <div className="text-sm font-bold text-white/40">vs</div>
        <MemberPicker color="b" label="B" member={data?.memberB ?? null} onPick={(id) => pushQuery({ b: id })} />
      </div>
      {data && (
        <div className="mb-5 flex justify-center">
          <button
            type="button"
            onClick={() => pushQuery({ a: data.memberB.id, b: data.memberA.id })}
            className="text-[11.5px] font-semibold text-gold-hover hover:text-gold"
          >
            ⇄ Swap
          </button>
        </div>
      )}

      {!data ? (
        <div className="rounded-xl border border-border-default bg-surface p-8 text-center text-sm text-white/40">Pick two members above to compare their usage.</div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div className="inline-flex rounded-lg border border-border-default bg-surface p-1">
              <button
                type="button"
                onClick={() => setView('list')}
                className={`rounded-md px-4 py-1.5 text-[13px] font-semibold ${view === 'list' ? 'bg-gold text-black' : 'text-white/50 hover:text-white'}`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setView('chart')}
                className={`rounded-md px-4 py-1.5 text-[13px] font-semibold ${view === 'chart' ? 'bg-gold text-black' : 'text-white/50 hover:text-white'}`}
              >
                Chart
              </button>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-[13px]">
              <span className="text-white/40">Range</span>
              {RANGE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => pushQuery({ days: d })}
                  className={`rounded-md px-2 py-0.5 font-semibold ${d === currentDays ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5 flex gap-5 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 text-white/60">
              <span className="h-0.75 w-3.5 rounded-sm bg-blue-400" />
              <b className="text-white">{data.memberA.name}</b>
            </span>
            <span className="inline-flex items-center gap-1.5 text-white/60">
              <span className="h-0.75 w-3.5 rounded-sm bg-gold" />
              <b className="text-white">{data.memberB.name}</b>
            </span>
          </div>

          {data.tools.length === 0 && <div className="rounded-xl border border-border-default bg-surface p-8 text-center text-sm text-white/40">No usage from either member in this range.</div>}

          <div className="space-y-3.5">
            {data.tools.map((t) => (
              <div key={t.slug} className="rounded-xl border border-border-default bg-surface p-5">
                <div className="mb-3.5 flex items-center gap-3">
                  <img src={t.wordmark} alt={t.name} className="h-4.5 w-auto" />
                  {t.live && <span className="rounded-md bg-green/10 px-2 py-0.5 text-[10px] font-semibold text-green">Live</span>}
                </div>
                {view === 'list' ? (
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-1">
                    <div className="pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-white/30">Metric</div>
                    <div className="pb-2 text-right text-[10.5px] font-semibold uppercase tracking-wide text-blue-400">{data.memberA.name}</div>
                    <div className="pb-2 text-right text-[10.5px] font-semibold uppercase tracking-wide text-gold">{data.memberB.name}</div>
                    {t.stats.map((s) => (
                      <Fragment key={s.label}>
                        <div className="border-t border-border-default py-2 text-[13px] text-white/60">{s.label}</div>
                        <div className="border-t border-border-default py-2 text-right font-mono text-[15px] font-bold tabular-nums text-blue-400">{s.a}</div>
                        <div className="border-t border-border-default py-2 text-right font-mono text-[15px] font-bold tabular-nums text-gold">{s.b}</div>
                      </Fragment>
                    ))}
                  </div>
                ) : (
                  <TrendChart seriesA={t.seriesA} seriesB={t.seriesB} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
