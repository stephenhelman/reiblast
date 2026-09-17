'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { RANGE_LABELS, SOURCE_LABELS, type RangeKey, type SourceFilter } from '@/lib/adminFilters'

const RANGE_OPTIONS = Object.keys(RANGE_LABELS) as RangeKey[]
const SOURCE_OPTIONS = Object.keys(SOURCE_LABELS) as SourceFilter[]

/** Filters (Range, Source) are the ONLY controls on Overview that refetch — changing either pushes a new URL, which re-runs the server component. The lens toggle never touches this. */
export default function FiltersBar({ range, source }: { range: RangeKey; source: SourceFilter }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(key, value)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-white/70">
        <span className="text-[11px] uppercase tracking-wide text-white/40">Range</span>
        <select
          value={range}
          onChange={(e) => setParam('range', e.target.value)}
          className="cursor-pointer bg-transparent font-medium text-white focus:outline-none"
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r} value={r} className="bg-surface text-white">
              {RANGE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-white/70">
        <span className="text-[11px] uppercase tracking-wide text-white/40">Source</span>
        <select
          value={source}
          onChange={(e) => setParam('source', e.target.value)}
          className="cursor-pointer bg-transparent font-medium text-white focus:outline-none"
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-surface text-white">
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
