import { getAdminMembersList } from '@/lib/adminMembersList'
import MembersRoster from '@/components/admin/MembersRoster'

export const dynamic = 'force-dynamic'

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const q = searchParams.q ?? ''
  const { rows, counts } = await getAdminMembersList(q)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Members</h1>
          <p className="text-sm text-white/40">Your REItools customers — attention queue up top, full roster below.</p>
        </div>
        <form method="GET" className="w-70">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search members…"
            className="w-full rounded-xl border border-border-default bg-black px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
          />
        </form>
      </div>

      <MembersRoster rows={rows} counts={counts} />
    </div>
  )
}
