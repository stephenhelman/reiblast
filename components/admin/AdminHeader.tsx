import Image from 'next/image'
import { portalBrand } from '@/lib/brandAssets'
import { adminLogoutAction } from '@/app/admin/actions'
import TopNav from '@/components/shared/TopNav'

// Same shared Tools|Store|Admin nav as the launcher/store AppHeader
// (components/shared/TopNav.tsx) — this surface only ever renders once
// requireAdmin has confirmed role === 'admin', so it's passed directly.
export default function AdminHeader({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-6 border-b border-border-default bg-black/95 px-6 py-4 backdrop-blur-md md:px-12">
      <div className="flex items-center gap-6">
        <Image src={portalBrand.wordmark} alt="REI/tools" height={26} width={130} style={{ height: 26, width: 'auto' }} />
        <TopNav role="admin" />
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-white/40">Admin</p>
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-gold-hover to-gold text-xs font-bold text-black">
          {initials || '?'}
        </span>
        <form action={adminLogoutAction}>
          <button type="submit" className="text-xs text-white/40 transition-colors hover:text-white">
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
