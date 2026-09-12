import Image from 'next/image'
import { portalBrand } from '@/lib/brandAssets'

/** Lighter than the tools AppHeader — no account block, no balance, no cart. Discovery has no logged-in member. */
export default function DiscoveryHeader() {
  return (
    <header className="flex items-center justify-center border-b border-border-default bg-black px-6 py-4.5">
      <Image src={portalBrand.wordmark} alt="REI/tools" height={28} width={130} style={{ height: 28, width: 'auto' }} />
    </header>
  )
}
