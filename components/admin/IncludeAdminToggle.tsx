'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export default function IncludeAdminToggle({ includeAdmin }: { includeAdmin: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function toggle() {
    const params = new URLSearchParams(searchParams.toString())
    if (includeAdmin) {
      params.delete('includeAdmin')
    } else {
      params.set('includeAdmin', '1')
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
      <input type="checkbox" checked={includeAdmin} onChange={toggle} className="accent-gold" />
      Include admin runs
    </label>
  )
}
