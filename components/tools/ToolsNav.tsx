'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoFull } from '../shared/Logo'

const NAV_ITEMS = [
  { href: '/tools', label: 'Dashboard', icon: '⌂' },
  { href: '/tools/analyzer', label: 'Deal Analyzer', icon: '🧮' },
  { href: '/tools/jv', label: 'JV Submission', icon: '🤝' },
  { href: '/tools/leads', label: 'Lead Sourcing', icon: '📋' },
]

export default function ToolsNav() {
  const pathname = usePathname()

  return (
    <nav className="h-16 border-b border-border-default bg-black/95 backdrop-blur-sm flex items-center px-6 gap-8 sticky top-0 z-50">
      <Link href="/tools" className="shrink-0">
        <LogoFull size={28} />
      </Link>

      <div className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${active
                  ? 'bg-gold/15 text-gold'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <span>{item.icon}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          )
        })}
      </div>

      <div className="ml-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gold/10 border border-gold/30 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-gold" />
          <span className="text-gold text-xs font-medium">Core Plan</span>
        </div>
      </div>
    </nav>
  )
}
