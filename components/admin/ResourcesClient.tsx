'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { AdminResourcesData } from '@/lib/adminResources'
import { RANGE_LABELS, type RangeKey } from '@/lib/adminFilters'
import { formatCents } from '@/lib/money'
import { formatCentsOrDash } from '@/components/admin/money'

const RANGE_OPTIONS = Object.keys(RANGE_LABELS) as RangeKey[]

function PeriodPicker({ range }: { range: RangeKey }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setRange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', value)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <label className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-white/70">
      <span className="text-[11px] uppercase tracking-wide text-white/40">Period</span>
      <select
        value={range}
        onChange={(e) => setRange(e.target.value)}
        className="cursor-pointer bg-transparent font-medium text-white focus:outline-none"
      >
        {RANGE_OPTIONS.map((r) => (
          <option key={r} value={r} className="bg-surface text-white">
            {RANGE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  )
}

function TotalCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface p-5">
      <div className="mb-2 text-xs text-white/50">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/40">{sub}</div>
    </div>
  )
}

function VendorHead({ label, note, badge }: { label: string; note: string; badge: { text: string; className: string } }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <div className="text-base font-bold text-white">{label}</div>
        <div className="text-xs text-white/40">{note}</div>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}>{badge.text}</span>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[11px] text-white/40">{label}</div>
    </div>
  )
}

export default function ResourcesClient({ data, range }: { data: AdminResourcesData; range: RangeKey }) {
  const { melissa, rentcast, sonnet, haiku } = data
  const cycleReset = new Date(data.cycleResetsAt)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2.5">
        <PeriodPicker range={range} />
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-gold-hover/40 bg-gold/10 p-4 text-sm text-white/70">
        <span className="text-gold">🔒</span>
        <div>
          Read-only. Rate &amp; plan editing arrives in a later version — for now these values reflect what&apos;s configured in{' '}
          <code className="text-white/90">VendorRate</code> / <code className="text-white/90">VendorPlan</code>. Every call in the window
          counts, including admin usage — this is the vendor bill, not a client-only view.
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TotalCard label="Total vendor spend" value={formatCents(data.totalSpendCents)} sub="this billing cycle" />
        <TotalCard label="Total API calls" value={data.totalCalls.toLocaleString()} sub="across all vendors" />
        <TotalCard label="Anthropic tokens" value={data.totalAnthropicTokens.toLocaleString()} sub="Sonnet + Haiku" />
        <TotalCard
          label="Cycle resets"
          value={cycleReset.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          sub={`${data.cycleDaysLeft} days left`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Melissa — per-call */}
        <div className="rounded-xl border border-border-default bg-surface p-5">
          <VendorHead label={melissa.label} note={melissa.note} badge={{ text: 'per-call rate', className: 'bg-blue-400/15 text-blue-400' }} />
          <div className="mb-4 text-sm text-white/60">
            Rate:{' '}
            <span className="font-semibold text-white">{melissa.rateCents !== null ? `${melissa.rateCents}¢ / call` : 'pending'}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border-default pt-4">
            <Stat value={melissa.calls.toLocaleString()} label="calls" />
            <Stat value={formatCents(melissa.costCents)} label="cost" />
            <Stat value={melissa.avgLatencyMs !== null ? `${melissa.avgLatencyMs}ms` : '—'} label="avg latency" />
          </div>
        </div>

        {/* Rentcast — subscription plan + quota gauge */}
        <div className="rounded-xl border border-gold-hover/50 bg-surface p-5">
          <VendorHead label={rentcast.label} note={rentcast.note} badge={{ text: 'subscription plan', className: 'bg-purple-400/15 text-purple-300' }} />
          <div className="mb-4 text-sm text-white/60">
            Plan: <span className="font-semibold text-white">{formatCents(rentcast.baseMonthlyCents)}/mo</span> ·{' '}
            {rentcast.includedQuota.toLocaleString()} calls included ·{' '}
            <span className="font-semibold text-white">{rentcast.overageCentsPerCall}¢</span> / overage call
          </div>
          <div className="mb-4 grid grid-cols-3 gap-3 border-t border-border-default pt-4">
            <Stat value={rentcast.calls.toLocaleString()} label="calls" />
            <Stat value={formatCents(rentcast.costCents)} label="cost" />
            <Stat value={`${rentcast.effCentsPerCall.toFixed(1)}¢`} label="eff. / call" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-white/50">
              <span>Included quota used</span>
              <span className="font-semibold text-white">
                {rentcast.calls.toLocaleString()} / {rentcast.includedQuota.toLocaleString()}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full rounded-full ${rentcast.fillPct > 100 ? 'bg-red' : 'bg-gold'}`}
                style={{ width: `${Math.min(100, rentcast.fillPct)}%` }}
              />
            </div>
            {rentcast.overageCalls > 0 ? (
              <div
                className="mt-1.5 text-xs font-medium text-red"
                title={`${rentcast.overageCalls.toLocaleString()} overage calls × ${rentcast.overageCentsPerCall}¢ = ${formatCents(rentcast.overageCostCents)}`}
              >
                {rentcast.overageCalls.toLocaleString()} over quota · +{formatCents(rentcast.overageCostCents)}
              </div>
            ) : (
              <div className="mt-1.5 text-xs text-white/40">within quota</div>
            )}
          </div>
        </div>

        {/* Claude Sonnet 5 — per-token */}
        <div className="rounded-xl border border-border-default bg-surface p-5">
          <VendorHead label={sonnet.label} note={sonnet.note} badge={{ text: 'per-token rate', className: 'bg-green/15 text-green' }} />
          <div className="mb-4 text-sm text-white/60">
            Rate:{' '}
            <span className="font-semibold text-white">
              {sonnet.inputRatePerMillionCents !== null && sonnet.outputRatePerMillionCents !== null
                ? `${formatCents(sonnet.inputRatePerMillionCents)} / ${formatCents(sonnet.outputRatePerMillionCents)} per 1M`
                : 'pending'}
            </span>{' '}
            (input / output)
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border-default pt-4">
            <Stat value={sonnet.calls.toLocaleString()} label="calls" />
            <Stat value={formatCents(sonnet.costCents)} label="cost" />
            <Stat value={sonnet.totalTokens.toLocaleString()} label="total tokens" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat value={sonnet.avgTokensPerCall.toLocaleString()} label="avg tokens/call" />
            <Stat value={`${sonnet.inputTokens.toLocaleString()} / ${sonnet.outputTokens.toLocaleString()}`} label="input / output" />
          </div>
        </div>

        {/* Claude Haiku — per-token, currently zero usage */}
        <div className="rounded-xl border border-border-default bg-surface p-5">
          <VendorHead label={haiku.label} note={haiku.note} badge={{ text: 'per-token rate', className: 'bg-green/15 text-green' }} />
          <div className="mb-4 text-sm text-white/60">
            Rate:{' '}
            <span className="font-semibold text-white">
              {haiku.inputRatePerMillionCents !== null && haiku.outputRatePerMillionCents !== null
                ? `${formatCents(haiku.inputRatePerMillionCents)} / ${formatCents(haiku.outputRatePerMillionCents)} per 1M`
                : 'pending'}
            </span>{' '}
            (input / output)
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border-default pt-4">
            <Stat value={haiku.calls.toLocaleString()} label="calls" />
            <Stat value={formatCentsOrDash(haiku.costCents)} label="cost" />
            <Stat value={haiku.totalTokens.toLocaleString()} label="total tokens" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat value={haiku.avgTokensPerCall.toLocaleString()} label="avg tokens/call" />
            <Stat value={`${haiku.inputTokens.toLocaleString()} / ${haiku.outputTokens.toLocaleString()}`} label="input / output" />
          </div>
          {haiku.calls === 0 ? (
            <div className="mt-3 rounded-lg bg-black/30 px-3 py-2 text-xs text-white/40">
              no usage yet — cost basis ready for when REI/ask &amp; bots launch
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
