import { notFound } from 'next/navigation'
import { getAdminToolDetail } from '@/lib/adminToolDetail'
import { parseRange, parseSource } from '@/lib/adminFilters'
import ToolDetailClient from '@/components/admin/ToolDetailClient'

export const dynamic = 'force-dynamic'

export default async function AdminToolDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { range?: string; source?: string; from?: string; to?: string; member?: string }
}) {
  const range = parseRange(searchParams.range)
  const source = parseSource(searchParams.source)
  const memberUserId = searchParams.member ?? null

  // Loaded ONCE over {slug} x Range x Source x member — all three lenses'
  // hero/series are computed here, up front. Lens + in-chart legend toggles
  // are client-side over this payload inside ToolDetailClient; only
  // range/source/member (via the URL) refetch.
  const data = await getAdminToolDetail(params.slug, range, source, memberUserId, undefined, searchParams.from, searchParams.to)
  if (!data) notFound()

  return <ToolDetailClient data={data} />
}
