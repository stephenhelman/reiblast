import Link from 'next/link'
import { LogoFull } from '../shared/Logo'

export default function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border-default bg-black/90 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/">
          <LogoFull size={32} />
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <Link href="/#features" className="text-white/70 hover:text-white text-sm transition-colors">
            Features
          </Link>
          <Link href="/pricing" className="text-white/70 hover:text-white text-sm transition-colors">
            Pricing
          </Link>
          <Link href="/login" className="text-white/70 hover:text-white text-sm transition-colors">
            Login
          </Link>
          <Link
            href="/signup"
            className="bg-gold text-black font-semibold text-sm px-5 py-2 rounded-lg hover:bg-gold-hover transition-colors"
          >
            Get Started
          </Link>
        </div>
        <Link
          href="/signup"
          className="md:hidden bg-gold text-black font-semibold text-sm px-4 py-2 rounded-lg"
        >
          Get Started
        </Link>
      </div>
    </nav>
  )
}
