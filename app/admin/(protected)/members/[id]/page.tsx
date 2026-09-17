import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMemberDetail } from '@/lib/adminMembers'

export const dynamic = 'force-dynamic'

const BUNDLE_LABEL: Record<string, string> = {
  'bundle-plus': 'Bundle Plus',
  'bundle-pro': 'Bundle Pro',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function AdminMemberDetailPage({ params }: { params: { id: string } }) {
  const member = await getMemberDetail(params.id)
  if (!member) notFound()

  return (
    <div className="space-y-6">
      <Link href="/admin/members" className="text-sm text-white/50 hover:text-white">
        ← Members
      </Link>

      <div className="rounded-xl border border-border-default bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{member.name ?? member.email}</h1>
            <p className="text-sm text-white/50">{member.email}</p>
            {member.businessName && <p className="text-sm text-white/40">{member.businessName}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full border border-border-default px-3 py-1 text-xs uppercase tracking-wide text-white/70">
              {member.status}
            </span>
            {member.onboardingStage && <span className="text-xs text-white/40">{member.onboardingStage}</span>}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-black p-4">
            <p className="text-xs uppercase tracking-wide text-white/40">Wallet balance</p>
            <p className={`mt-1 text-xl font-bold ${member.walletBalance !== null && member.walletBalance < 0 ? 'text-red' : 'text-white'}`}>
              {member.walletBalance !== null ? `${member.walletBalance} credits` : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-black p-4">
            <p className="text-xs uppercase tracking-wide text-white/40">Bundle status (derived)</p>
            <p className="mt-1 text-xl font-bold text-white">
              {member.currentBundleSlug ? BUNDLE_LABEL[member.currentBundleSlug] ?? member.currentBundleSlug : 'None'}
            </p>
          </div>
          <div className="rounded-lg bg-black p-4">
            <p className="text-xs uppercase tracking-wide text-white/40">Member since</p>
            <p className="mt-1 text-xl font-bold text-white">{formatDate(member.createdAt)}</p>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border-default bg-surface p-5">
        <h2 className="mb-4 text-lg font-bold text-white">Subscriptions</h2>
        {member.subscriptions.length === 0 ? (
          <p className="text-sm text-white/40">No tool subscriptions — core-included only.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-default text-xs uppercase tracking-wide text-white/40">
                  <th className="pb-2 pr-4">Plan</th>
                  <th className="pb-2 pr-4">Feature</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Period</th>
                </tr>
              </thead>
              <tbody>
                {member.subscriptions.map((s) => (
                  <tr key={s.id} className="border-b border-border-default last:border-0">
                    <td className="py-2 pr-4 font-semibold text-white">{s.displayName}</td>
                    <td className="py-2 pr-4 text-white/70">{s.featureSlug}</td>
                    <td className="py-2 pr-4">
                      {s.status === 'past_due' ? (
                        <span className="rounded-full bg-red/20 px-2 py-0.5 text-xs font-semibold text-red">past due</span>
                      ) : (
                        <span className="text-white/70">{s.status}</span>
                      )}
                    </td>
                    <td className="py-2 text-white/50">
                      {formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border-default bg-surface p-5">
        <h2 className="mb-1 text-lg font-bold text-white">Ledger history</h2>
        <p className="mb-4 text-xs text-white/40">Client-eyes only — credits/usage, no company cost.</p>
        {member.ledger.length === 0 ? (
          <p className="text-sm text-white/40">No ledger entries.</p>
        ) : (
          <div className="max-h-[480px] overflow-x-auto overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border-default text-xs uppercase tracking-wide text-white/40">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Kind</th>
                  <th className="pb-2 pr-4">Tool / reason</th>
                  <th className="pb-2 pr-4">Delta</th>
                  <th className="pb-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {member.ledger.map((l) => (
                  <tr key={l.id} className="border-b border-border-default last:border-0">
                    <td className="py-2 pr-4 text-white/50">{formatDate(l.createdAt)}</td>
                    <td className="py-2 pr-4 text-white/70">{l.kind}</td>
                    <td className="py-2 pr-4 text-white/70">{l.toolName ?? l.reason ?? '—'}</td>
                    <td className={`py-2 pr-4 font-semibold ${l.creditDelta >= 0 ? 'text-green' : 'text-red'}`}>
                      {l.creditDelta >= 0 ? '+' : ''}
                      {l.creditDelta}
                    </td>
                    <td className="py-2 text-white/50">
                      {l.outcome ?? (l.allowanceCovered ? 'allowance' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
