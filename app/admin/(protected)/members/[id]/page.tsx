import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Stub — the full member dossier (subscriptions, ledger, credit/sub write
// actions) lands as v1.5. This pass only confirms the roster row resolves to
// a real member and links through.
export default async function AdminMemberDetailPage({ params }: { params: { id: string } }) {
  const member = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, name: true, email: true } })
  if (!member) notFound()

  return (
    <div className="space-y-6">
      <Link href="/admin/members" className="text-sm text-white/50 hover:text-white">
        ← Members
      </Link>
      <div className="rounded-xl border border-border-default bg-surface p-8 text-center">
        <h1 className="text-xl font-bold text-white">{member.name ?? member.email}</h1>
        <p className="mt-2 text-sm text-white/40">Member dossier — coming in v1.5.</p>
      </div>
    </div>
  )
}
