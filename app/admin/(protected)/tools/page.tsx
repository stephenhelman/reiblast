import { getAdminTools } from '@/lib/adminTools'
import { parseRange, parseSource } from '@/lib/adminFilters'
import ToolsClient from '@/components/admin/ToolsClient'

export const dynamic = 'force-dynamic'

export default async function AdminToolsPage({
  searchParams,
}: {
  searchParams: { range?: string; source?: string; from?: string; to?: string }
}) {
  const range = parseRange(searchParams.range)
  const source = parseSource(searchParams.source)

  // Loaded ONCE over the active (server-side) filters — all three lenses'
  // per-tool series + totals + leaderboards are computed here, up front. The
  // lens toggle inside ToolsClient is client-side state over this payload;
  // it never triggers another fetch. Only range/source (via FiltersBar) do.
  const data = await getAdminTools(range, source, undefined, searchParams.from, searchParams.to)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-white">Tools</h1>
      <p className="mb-6 text-sm text-white/40">Per-tool trends and top members — client-only lines; admin/client split lives on each tool&apos;s deep page.</p>
      <ToolsClient data={data} range={range} source={source} />
    </div>
  )
}
