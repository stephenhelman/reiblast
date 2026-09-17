'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type TopNavRole = 'user' | 'admin' | 'manager' | 'team_lead'

// Everything here lives on the tools.reiblast.app subdomain, root-relative —
// tools.reiblast.app itself IS the launcher ("/"), the store is "/store",
// admin is "/admin". There is no "/tools" prefix on the real host; that
// prefix only exists as the physical app/tools/* file route the middleware
// rewrites root-relative requests INTO server-side (see middleware.ts) —
// links must target the root-relative form, never the physical one.
const ITEMS = [
  { href: '/', label: 'Tools' },
  { href: '/store', label: 'Store' },
]

/**
 * The one Tools|Store|(Admin) nav — same component on the member launcher,
 * store, and the admin shell. Admin only renders when role === 'admin';
 * everywhere else (including manager/team_lead, which have no admin perms
 * defined yet) it's just Tools|Store.
 */
export default function TopNav({ role }: { role: TopNavRole }) {
  const pathname = usePathname()
  const isAdmin = role === 'admin'

  // usePathname() can reflect either the root-relative request path (real
  // host) or the rewritten /tools/* physical path (server-rendered target,
  // and what you get hitting the app's file routes directly in dev) —
  // handle both forms so "active" highlighting is correct either way.
  const isStore = pathname === '/store' || pathname.startsWith('/store/') || pathname.startsWith('/tools/store')
  const isAdminPath = pathname.startsWith('/admin')
  const isToolsActive = !isStore && !isAdminPath

  return (
    <nav className="flex gap-1">
      {ITEMS.map((item) => {
        const active = item.label === 'Store' ? isStore : isToolsActive
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active ? 'bg-gold/15 text-gold' : 'text-white/50 hover:bg-surface hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
      {isAdmin && (
        <Link
          href="/admin"
          className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors ${
            pathname.startsWith('/admin') ? 'border-gold-hover bg-gold/15 text-gold' : 'border-gold-hover text-gold hover:bg-gold/10'
          }`}
        >
          Admin
        </Link>
      )}
    </nav>
  )
}
