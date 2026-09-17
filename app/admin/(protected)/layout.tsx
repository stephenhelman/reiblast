import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin, RequireAdminError } from '@/lib/requireAdmin'
import AdminHeader from '@/components/admin/AdminHeader'
import AdminSubNav from '@/components/admin/AdminSubNav'
import DesktopOnlyGate from '@/components/admin/DesktopOnlyGate'

export const dynamic = 'force-dynamic'

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  let name = 'Admin'
  try {
    const admin = await requireAdmin(prisma)
    const user = await prisma.user.findUnique({ where: { id: admin.userId }, select: { name: true } })
    name = user?.name ?? 'Admin'
  } catch (err) {
    if (err instanceof RequireAdminError) {
      redirect('/tools/session-expired')
    }
    throw err
  }

  return (
    <DesktopOnlyGate>
      <div className="min-h-screen bg-black">
        <AdminHeader name={name} />
        <AdminSubNav />
        <main className="mx-auto max-w-7xl px-6 py-8 md:px-12">{children}</main>
      </div>
    </DesktopOnlyGate>
  )
}
