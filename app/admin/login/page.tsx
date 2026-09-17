import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { verifyAdminSession, ADMIN_SESSION_COOKIE } from '@/lib/adminSession'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function AdminLoginPage() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value
  if (token) {
    const session = await verifyAdminSession(token)
    if (session) {
      const user = await prisma.user.findUnique({ where: { id: session.userId } })
      if (user?.role === 'admin') {
        redirect('/admin')
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-8">
        <h1 className="mb-1 text-xl font-bold text-white">Admin sign in</h1>
        <p className="mb-6 text-sm text-white/50">REIblast operator dashboard.</p>
        <LoginForm />
      </div>
    </div>
  )
}
