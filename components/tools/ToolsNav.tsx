'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoFull } from '../shared/Logo'
import { useLocationId, toolUrl } from '@/lib/hooks/use-location-id'

const NAV_ITEMS = [
  { path: '/analyzer', label: 'Deal Analyzer', icon: '⌂' },
  { path: '/jv', label: 'JV Submission', icon: '🤝' },
  { path: '/leads', label: 'Lead Sourcing', icon: '📋' },
]

function NavLinks() {
  const pathname = usePathname()
  const locationId = useLocationId()

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = pathname.startsWith(item.path)
        return (
          <Link
            key={item.path}
            href={toolUrl(item.path, locationId)}
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
    </>
  )
}

export default function ToolsNav() {
  const pathname = usePathname()

  return (
    <nav className="h-16 border-b border-border-default bg-black/95 backdrop-blur-sm flex items-center px-6 gap-8 sticky top-0 z-50">
      <Link href="/analyzer" className="shrink-0">
        <LogoFull size={28} />
      </Link>

      <div className="flex items-center gap-1">
        <Suspense
          fallback={NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname.startsWith(item.path) ? 'bg-gold/15 text-gold' : 'text-white/50'
              }`}
            >
              <span>{item.icon}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          ))}
        >
          <NavLinks />
        </Suspense>
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
