import { getAdminResources } from '@/lib/adminResources'
import { parseRange } from '@/lib/adminFilters'
import ResourcesClient from '@/components/admin/ResourcesClient'

export const dynamic = 'force-dynamic'

export default async function AdminResourcesPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string }
}) {
  const range = parseRange(searchParams.range ?? 'billing_current')
  const data = await getAdminResources(range, undefined, searchParams.from, searchParams.to)

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Resources</h1>
          <p className="mt-1 text-sm text-white/40">the rates and plans every cost number derives from</p>
        </div>
      </div>
      <ResourcesClient data={data} range={range} />
    </div>
  )
}
