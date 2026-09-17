import Link from 'next/link'
import { adminLogoutAction } from '@/app/admin/actions'

export default function AdminNav() {
  return (
    <header className="border-b border-border-default bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <span className="text-sm font-bold tracking-wide text-gold">REIblast Admin</span>
          <nav className="flex gap-6 text-sm">
            <Link href="/admin" className="text-white/70 transition-colors hover:text-white">
              Overview
            </Link>
            <Link href="/admin/members" className="text-white/70 transition-colors hover:text-white">
              Members
            </Link>
          </nav>
        </div>
        <form action={adminLogoutAction}>
          <button type="submit" className="text-sm text-white/50 transition-colors hover:text-white">
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
