import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin, RequireAdminError } from '@/lib/adminSession'
import AdminNav from '@/components/admin/AdminNav'

export const dynamic = 'force-dynamic'

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin(prisma)
  } catch (err) {
    if (err instanceof RequireAdminError) {
      redirect('/admin/login')
    }
    throw err
  }

  return (
    <div className="min-h-screen bg-black">
      <AdminNav />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
