'use client'

import { useState } from 'react'
import { formatCents } from '@/lib/money'
import type { ToolUsageRow } from '@/lib/adminMemberDetail'

function LineChart({ series }: { series: ToolUsageRow['series'] }) {
  const W = 1000
  const H = 160
  const n = series.length
  if (n < 2) return <div className="h-[160px] w-full" />

  const maxRuns = Math.max(1, ...series.map((p) => p.runs)) * 1.15
  const maxCost = Math.max(1, ...series.map((p) => p.costCents)) * 1.15

  function pathFor(key: 'runs' | 'costCents', max: number) {
    return series
      .map((p, i) => {
        const x = 10 + (i / (n - 1)) * (W - 20)
        const y = H - 10 - (p[key] / max) * (H - 20)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  return (
    <div className="h-[160px] w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={0} y1={10 + (i * (H - 20)) / 3} x2={W} y2={10 + (i * (H - 20)) / 3} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        <polyline points={pathFor('runs', maxRuns)} fill="none" stroke="var(--color-gold, #f5c842)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={pathFor('costCents', maxCost)} fill="none" stroke="var(--color-red, #f0464b)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export default function MemberToolUsage({ tools }: { tools: ToolUsageRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  return (
    <div className="flex flex-col gap-3">
      {tools.map((t) => {
        const hasUsage = t.runs > 0
        const isOpen = !!open[t.slug] && hasUsage
        return (
          <div key={t.slug} className="overflow-hidden rounded-xl border border-border-default bg-surface">
            <div
              className={`flex items-center gap-3.5 px-5 py-4 ${hasUsage ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
              onClick={hasUsage ? () => setOpen((prev) => ({ ...prev, [t.slug]: !prev[t.slug] })) : undefined}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`h-4 w-4 flex-none text-white/40 transition-transform ${isOpen ? 'rotate-90' : ''} ${!hasUsage ? 'opacity-25' : ''}`}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              <img src={t.wordmark} alt={t.name} className="h-4.5 w-auto" />
              <div className="ml-auto flex items-center gap-4">
                {hasUsage ? (
                  <>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-white/60">
                      <span className="h-[3px] w-2.5 rounded-sm" style={{ background: 'var(--color-gold, #f5c842)' }} />
                      Runs <span className="ml-0.5 font-bold tabular-nums text-white">{t.runs}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-white/60">
                      <span className="h-[3px] w-2.5 rounded-sm" style={{ background: 'var(--color-red, #f0464b)' }} />
                      Cost <span className="ml-0.5 font-bold tabular-nums text-white">{formatCents(t.costCents)}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-[11.5px] text-white/40">No usage</span>
                )}
              </div>
            </div>
            {isOpen && (
              <div className="px-5 pb-4.5">
                <LineChart series={t.series} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
