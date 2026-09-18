'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tools', label: 'Tools' },
  { href: '/admin/resources', label: 'Resources' },
  { href: '/admin/members', label: 'Members' },
]

export default function AdminSubNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 border-b border-border-default bg-black px-6 md:px-12">
      {ITEMS.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`-mb-px border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${
              active ? 'border-gold text-gold' : 'border-transparent text-white/50 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
