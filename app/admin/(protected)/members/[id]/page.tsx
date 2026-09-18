import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getAdminMemberDetail, type PlanFitData } from '@/lib/adminMemberDetail'
import { formatCents } from '@/lib/money'
import MemberToolUsage from '@/components/admin/MemberToolUsage'

export const dynamic = 'force-dynamic'

const BUNDLE_LABEL: Record<string, string> = { 'bundle-plus': 'Bundle Plus', 'bundle-pro': 'Bundle Pro' }
const STATUS_LABEL: Record<string, string> = { active: 'Active', past_due: 'Past due', suspended: 'Suspended', canceled: 'Canceled' }
const STATUS_CLASS: Record<string, string> = {
  active: 'text-green bg-green/10',
  past_due: 'text-red bg-red/10',
  suspended: 'text-amber-400 bg-amber-500/10',
  canceled: 'text-white/40 bg-white/5',
}
const FLAG_THEME: Record<string, string> = {
  past_due: 'border-red/30 bg-red/5 text-red',
  neg_bal: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
  upsell: 'border-green/30 bg-green/5 text-green',
  downsell: 'border-blue-400/30 bg-blue-400/5 text-blue-400',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '').concat(parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '').toUpperCase()
}

function PlanFitChart({ planFit }: { planFit: PlanFitData }) {
  const W = 1000
  const H = 140
  const n = planFit.series.length
  if (n < 2) return <div className="h-[140px] w-full" />
  const maxVal = Math.max(1, planFit.runsAllowance, ...planFit.series.map((p) => p.cumulativeRuns)) * 1.15

  const linePoints = planFit.series
    .map((p, i) => {
      const x = 10 + (i / (n - 1)) * (W - 20)
      const y = H - 10 - (p.cumulativeRuns / maxVal) * (H - 20)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const areaPoints = `10,${H - 10} ${linePoints} ${W - 10},${H - 10}`

  const allowanceY = planFit.series[0].allowance !== null ? H - 10 - (planFit.series[0].allowance! / maxVal) * (H - 20) : null

  return (
    <div className="h-[140px] w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {[0, 1, 2].map((i) => (
          <line key={i} x1={0} y1={8 + (i * (H - 16)) / 2} x2={W} y2={8 + (i * (H - 16)) / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {allowanceY !== null && <line x1={0} y1={allowanceY} x2={W} y2={allowanceY} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" strokeWidth={1} />}
        <polygon points={areaPoints} fill="var(--color-green, #3fb950)" opacity={0.12} />
        <polyline points={linePoints} fill="none" stroke="var(--color-green, #3fb950)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export default async function AdminMemberDetailPage({ params }: { params: { id: string } }) {
  const data = await getAdminMemberDetail(params.id, prisma)
  if (!data) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-white/40">
        <Link href="/admin" className="hover:text-white">
          Admin
        </Link>
        <span>›</span>
        <Link href="/admin/members" className="hover:text-white">
          Members
        </Link>
        <span>›</span>
        <span className="text-white/70">{data.name}</span>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border-default bg-surface p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">{initials(data.name)}</div>
          <div>
            <h1 className="text-xl font-bold text-white">{data.name}</h1>
            <div className="text-[11.5px] text-white/40">
              {data.locationId} · member since{' '}
              {new Date(data.memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>
        <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[data.status]}`}>{STATUS_LABEL[data.status]}</span>
      </div>

      {data.flagDetails.length > 0 && (
        <div className="space-y-2.5">
          {data.flagDetails.map((f) => (
            <div key={f.flag} className={`flex items-start justify-between gap-4 rounded-xl border p-4 ${FLAG_THEME[f.flag]}`}>
              <div>
                <div className="text-sm font-semibold">{f.title}</div>
                <div className="mt-1 text-[13px] leading-snug text-white/70">{f.detail}</div>
              </div>
              <Link
                href={`/admin/members/compare?a=${data.id}`}
                className="btn btn-out shrink-0 rounded-md border border-border-default px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white"
              >
                Compare usage
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border-default bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Wallet</span>
            <button type="button" disabled className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50">
              + Add credits
            </button>
          </div>
          <div className={`font-display text-3xl font-bold tabular-nums ${data.wallet.balance < 0 ? 'text-red' : 'text-white'}`}>
            {data.wallet.balance} <span className="text-[15px] font-normal text-white/40">cr</span>
          </div>
          <div className="mt-1 text-[11.5px] text-white/40">shared credit balance</div>
        </div>

        <div className="rounded-xl border border-border-default bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Subscriptions</span>
            <button type="button" disabled className="rounded-md border border-border-default px-3 py-1.5 text-xs font-semibold text-white/40 disabled:cursor-not-allowed disabled:opacity-50">
              Manage
            </button>
          </div>
          <div className="space-y-2.5">
            {data.subs.length === 0 && <p className="text-sm text-white/40">No active subscriptions.</p>}
            {data.subs.map((s) => (
              <div key={s.featureSlug} className="flex items-center justify-between rounded-lg border border-border-default bg-black px-3 py-2.5">
                <img src={s.wordmark} alt={s.displayName} className="h-4.5 w-auto" />
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-border-default bg-white/5 px-2 py-0.5 text-[10.5px] font-semibold text-white/70">{s.displayName}</span>
                  <span className="text-xs font-semibold tabular-nums text-white/70">{formatCents(s.priceCents)}/mo</span>
                </div>
              </div>
            ))}
            {data.bundleSlug && (
              <span className="inline-block rounded-md border border-gold-hover/60 bg-gold/10 px-2 py-0.5 text-[10.5px] font-semibold text-gold">
                {BUNDLE_LABEL[data.bundleSlug]}
              </span>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" disabled className="rounded-md border border-border-default px-3 py-1.5 text-xs font-semibold text-white/40 disabled:cursor-not-allowed disabled:opacity-50">
              + Add subscription
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-4 text-sm font-semibold text-white">Money · all time</div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-white/40">
              <span className="h-1.5 w-1.5 rounded-full bg-green" />
              Revenue
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-white">{formatCents(data.money.revenueCents)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-white/40">
              <span className="h-1.5 w-1.5 rounded-full bg-red" />
              Vendor cost
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-white">{formatCents(data.money.costCents)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-white/40">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              Margin
            </div>
            <div className={`mt-1 text-xl font-bold tabular-nums ${data.money.marginCents < 0 ? 'text-red' : 'text-gold'}`}>{formatCents(data.money.marginCents)}</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-4 text-sm font-semibold text-white">Plan fit · allowance vs credit</div>
        <PlanFitChart planFit={data.planFit} />
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <div className="text-lg font-bold tabular-nums text-white">
              {data.planFit.runsAllowance} / {data.planFit.runsTotal}
            </div>
            <div className="text-[11.5px] text-white/40">runs this cycle (allowance / total)</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-white">{data.planFit.pctOnCredits}%</div>
            <div className="text-[11.5px] text-white/40">on credits</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-amber-400">{data.planFit.creditCoveredRuns}</div>
            <div className="text-[11.5px] text-white/40">credit-covered runs</div>
          </div>
        </div>
        <div className="mt-4 border-t border-border-default pt-4 text-[13px] leading-relaxed text-white/70">{data.planFit.verdictText}</div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-4 text-sm font-semibold text-white">Tool usage</div>
        <MemberToolUsage tools={data.toolUsage} />
      </div>

      <div className="rounded-xl border border-border-default bg-surface p-5">
        <div className="mb-4 text-sm font-semibold text-white">Ledger · recent</div>
        <div className="space-y-1">
          {data.ledger.length === 0 && <p className="text-sm text-white/40">No transaction history.</p>}
          {data.ledger.map((l) => (
            <div key={l.id} className="grid grid-cols-[32px_1fr_auto_auto] items-center gap-3.5 rounded-lg px-2 py-2.5 hover:bg-white/[0.02]">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  l.icon === 'debit' ? 'bg-red/10 text-red' : l.icon === 'fund' ? 'bg-green/10 text-green' : 'bg-white/10 text-white/60'
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  {l.icon === 'debit' && <path d="M5 12h14" />}
                  {l.icon === 'fund' && <path d="M12 5v14M5 12h14" />}
                  {l.icon === 'adj' && <path d="M12 2v20M2 12h20" />}
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-white">{l.description}</div>
                <div className="text-[11.5px] text-white/40">{l.subDescription}</div>
              </div>
              <div className={`text-right text-sm font-semibold tabular-nums ${l.amount < 0 ? 'text-red' : 'text-green'}`}>
                {l.amount > 0 ? '+' : ''}
                {l.amount}
              </div>
              <div className="w-16 text-right text-sm tabular-nums text-white/40">{l.runningBalance}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
