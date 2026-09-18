import Link from 'next/link'
import { getAdminCompare } from '@/lib/adminCompare'
import CompareView from '@/components/admin/CompareView'

export const dynamic = 'force-dynamic'

export default async function AdminCompareMembersPage({ searchParams }: { searchParams: { a?: string; b?: string; days?: string } }) {
  const days = Number(searchParams.days) || 90
  const a = searchParams.a ?? null
  const b = searchParams.b ?? null
  const data = a && b ? await getAdminCompare(a, b, days) : null

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
        <span className="text-white/70">Compare</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-white">Compare usage</h1>
        <p className="text-sm text-white/40">Two members, side by side — usage only. Safe to show on a call.</p>
      </div>

      <CompareView data={data} currentA={a} currentB={b} currentDays={days} />
    </div>
  )
}
