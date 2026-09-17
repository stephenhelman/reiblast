import { getAdminOverview } from '@/lib/adminDashboard'
import { parseRange, parseSource } from '@/lib/adminFilters'
import OverviewClient from '@/components/admin/OverviewClient'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: { range?: string; source?: string; from?: string; to?: string }
}) {
  const range = parseRange(searchParams.range)
  const source = parseSource(searchParams.source)

  // Loaded ONCE over the active (server-side) filters — all three lens
  // triads (aggregate + per-tool) are computed here, up front. The lens
  // toggle inside OverviewClient is client-side state over this payload;
  // it never triggers another fetch. Only range/source do (via a URL push
  // that re-runs this server component).
  const data = await getAdminOverview(range, source, undefined, searchParams.from, searchParams.to)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-white">Overview</h1>
      <p className="mb-6 text-sm text-white/40">Admin-eyes — usage, vendor cost, and margin across every tool.</p>
      <OverviewClient data={data} range={range} source={source} />
    </div>
  )
}
