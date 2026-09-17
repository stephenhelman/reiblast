import Link from 'next/link'
import { listMembers } from '@/lib/adminMembers'

export const dynamic = 'force-dynamic'

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const q = searchParams.q ?? ''
  const members = await listMembers(q)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Members</h1>
        <p className="text-sm text-white/40">Client-eyes lookup — subscriptions, wallet, ledger. No vendor cost/margin here.</p>
      </div>

      <form method="GET" className="max-w-sm">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search email, name, business…"
          className="w-full rounded-xl border border-border-default bg-black px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
        />
      </form>

      <div className="overflow-x-auto rounded-xl border border-border-default bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-default text-xs uppercase tracking-wide text-white/40">
              <th className="p-4">Name</th>
              <th className="p-4">Email</th>
              <th className="p-4">Status</th>
              <th className="p-4">Role</th>
              <th className="p-4">Wallet</th>
              <th className="p-4">Flags</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-white/40">
                  No members found.
                </td>
              </tr>
            )}
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border-default last:border-0 hover:bg-black/40">
                <td className="p-4">
                  <Link href={`/admin/members/${m.id}`} className="font-semibold text-white hover:text-gold">
                    {m.name ?? '—'}
                  </Link>
                </td>
                <td className="p-4 text-white/70">{m.email}</td>
                <td className="p-4 text-white/70">{m.status}</td>
                <td className="p-4 text-white/70">{m.role}</td>
                <td className={`p-4 ${m.walletBalance !== null && m.walletBalance < 0 ? 'text-red' : 'text-white/70'}`}>
                  {m.walletBalance !== null ? `${m.walletBalance} credits` : '—'}
                </td>
                <td className="p-4">
                  {m.hasPastDueSub && (
                    <span className="rounded-full bg-red/20 px-2 py-0.5 text-xs font-semibold text-red">past due</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
