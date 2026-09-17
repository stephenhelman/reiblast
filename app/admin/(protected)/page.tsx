import { getAdminOverview } from '@/lib/adminDashboard'
import { formatCents } from '@/lib/money'
import StatTile from '@/components/admin/StatTile'
import Sparkline from '@/components/admin/Sparkline'
import IncludeAdminToggle from '@/components/admin/IncludeAdminToggle'

export const dynamic = 'force-dynamic'

const OUTCOME_COLOR: Record<string, string> = {
  success: 'bg-green',
  fail: 'bg-red',
  partial: 'bg-gold',
}

function OutcomeBar({ success, fail, partial }: { success: number; fail: number; partial: number }) {
  const total = success + fail + partial || 1
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-black">
      <div className={OUTCOME_COLOR.success} style={{ width: `${(success / total) * 100}%` }} />
      <div className={OUTCOME_COLOR.fail} style={{ width: `${(fail / total) * 100}%` }} />
      <div className={OUTCOME_COLOR.partial} style={{ width: `${(partial / total) * 100}%` }} />
    </div>
  )
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: { includeAdmin?: string }
}) {
  const includeAdmin = searchParams.includeAdmin === '1'
  const data = await getAdminOverview(includeAdmin)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-sm text-white/40">Last {data.windowDays} days · admin-eyes (usage + vendor cost + margin)</p>
        </div>
        <IncludeAdminToggle includeAdmin={includeAdmin} />
      </div>

      {/* Top strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Total runs" value={data.totalRuns.toLocaleString()} />
        <StatTile label="Total vendor cost" value={formatCents(data.totalVendorCostCents)} />
        <StatTile
          label="Est. margin"
          value={formatCents(data.estMarginCents)}
          tone={data.estMarginCents >= 0 ? 'good' : 'bad'}
          sublabel="revenue is list price (Stripe later)"
        />
        <StatTile label="Active members" value={data.activeMembers.toLocaleString()} sublabel="last 30 days" />
      </div>

      {/* Usage per tool */}
      <section className="rounded-xl border border-border-default bg-surface p-5">
        <h2 className="mb-4 text-lg font-bold text-white">Usage by tool</h2>
        <div className="space-y-5">
          {data.usage.length === 0 && <p className="text-sm text-white/40">No runs in window.</p>}
          {data.usage.map((tool) => (
            <div key={tool.featureSlug} className="grid grid-cols-1 gap-3 border-b border-border-default pb-4 last:border-0 last:pb-0 md:grid-cols-[140px_1fr_200px]">
              <div>
                <p className="font-semibold text-white">{tool.featureSlug}</p>
                <p className="text-xs text-white/40">{tool.totalRuns} runs</p>
              </div>
              <div className="flex flex-col justify-center gap-2">
                <Sparkline points={tool.series.map((p) => p.count)} />
                <OutcomeBar success={tool.success} fail={tool.fail} partial={tool.partial} />
              </div>
              <div className="flex flex-col justify-center gap-1 text-xs text-white/50">
                <span><span className="text-green">{tool.success}</span> success</span>
                <span><span className="text-red">{tool.fail}</span> fail</span>
                <span><span className="text-gold">{tool.partial}</span> partial</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Vendor cost + margin per tool */}
      <section className="rounded-xl border border-border-default bg-surface p-5">
        <h2 className="mb-1 text-lg font-bold text-white">Vendor cost &amp; margin by tool</h2>
        <p className="mb-4 text-xs text-white/40">
          Revenue is estimated (list price) — Stripe-derived revenue lands later. Fail-run cost is called out separately
          since it burns vendor spend with $0 revenue.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs uppercase tracking-wide text-white/40">
                <th className="pb-2 pr-4">Tool</th>
                <th className="pb-2 pr-4">Vendor cost</th>
                <th className="pb-2 pr-4">Rentcast share</th>
                <th className="pb-2 pr-4">Total cost</th>
                <th className="pb-2 pr-4">Revenue (est.)</th>
                <th className="pb-2 pr-4">Margin</th>
                <th className="pb-2">Fail-run cost</th>
              </tr>
            </thead>
            <tbody>
              {data.vendorCostByTool.map((t) => (
                <tr key={t.featureSlug} className="border-b border-border-default last:border-0">
                  <td className="py-2 pr-4 font-semibold text-white">{t.featureSlug}</td>
                  <td className="py-2 pr-4 text-white/70">{formatCents(t.vendorCostCents)}</td>
                  <td className="py-2 pr-4 text-white/70">{formatCents(t.rentcastCostCents)}</td>
                  <td className="py-2 pr-4 text-white/70">{formatCents(t.totalCostCents)}</td>
                  <td className="py-2 pr-4 text-white/70">{formatCents(t.revenueCents)}</td>
                  <td className={`py-2 pr-4 font-semibold ${t.marginCents >= 0 ? 'text-green' : 'text-red'}`}>
                    {formatCents(t.marginCents)}
                  </td>
                  <td className="py-2 text-white/70">
                    {t.failCostCents > 0 ? <span className="text-red">{formatCents(t.failCostCents)}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Rentcast panel */}
        <section className="rounded-xl border border-border-default bg-surface p-5">
          <h2 className="mb-1 text-lg font-bold text-white">Rentcast</h2>
          <p className="mb-4 text-xs text-white/40">
            {data.rentcast.isOpenPeriod ? (
              <span className="text-gold">In-progress period — cost/call is an estimate, decreasing as volume grows.</span>
            ) : (
              'Period closed — cost/call is final.'
            )}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <StatTile
              label="Calls this period"
              value={`${data.rentcast.periodCalls.toLocaleString()} / ${data.rentcast.includedQuota.toLocaleString()}`}
              sublabel={data.rentcast.periodCalls > data.rentcast.includedQuota ? 'over included quota' : 'within quota'}
              tone={data.rentcast.periodCalls > data.rentcast.includedQuota ? 'bad' : 'default'}
            />
            <StatTile label="Cost / call (this period)" value={`${data.rentcast.costPerCallCents.toFixed(2)}¢`} />
            <StatTile label="Base + overage this period" value={formatCents(data.rentcast.totalPeriodCostCents)} />
            <StatTile
              label="Sustained-volume trigger"
              value={data.rentcast.approachingUpgradeTrigger ? 'Approaching' : 'Not yet'}
              tone={data.rentcast.approachingUpgradeTrigger ? 'bad' : 'good'}
              sublabel="~3,000 sustained calls/mo"
            />
          </div>
          {data.rentcast.trend.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-white/40">Cumulative calls, {data.windowDays}-day window</p>
              <Sparkline points={data.rentcast.trend.map((t) => t.cumulativeCalls)} />
            </div>
          )}
        </section>

        {/* Cache effectiveness */}
        <section className="rounded-xl border border-border-default bg-surface p-5">
          <h2 className="mb-1 text-lg font-bold text-white">Cache effectiveness (Score)</h2>
          <p className="mb-4 text-xs text-white/40">Avg cost per run — the Rentcast-cost lever.</p>
          <div className="grid grid-cols-2 gap-4">
            <StatTile
              label="Fresh (property lookup)"
              value={formatCents(Math.round(data.cacheEffectiveness.freshCostCents))}
              sublabel={`${data.cacheEffectiveness.freshCount} runs`}
            />
            <StatTile
              label="Cache hit"
              value={formatCents(Math.round(data.cacheEffectiveness.cacheCostCents))}
              sublabel={`${data.cacheEffectiveness.cacheCount} runs`}
            />
          </div>
          <div className="mt-4 rounded-lg bg-black p-3 text-sm">
            <span className="text-white/60">Gap: </span>
            <span className="font-semibold text-gold">{formatCents(Math.round(data.cacheEffectiveness.gapCents))}</span>
            <span className="text-white/60"> saved per cache hit</span>
          </div>
        </section>
      </div>
    </div>
  )
}
