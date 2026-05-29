import Link from 'next/link'
import { LogoStacked } from '../shared/Logo'

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 overflow-hidden bg-black">
      {/* Subtle gold glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-175 h-175 rounded-full bg-gold/4 blur-[140px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-5xl mx-auto">
        <div className="mb-10 p-6.25">
          <LogoStacked size={120} />
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] mb-6 tracking-tight">
          <span className="text-white">From List to Blast —</span>
          <br />
          <span
            style={{
              background: 'linear-gradient(90deg, #F5C842 0%, #e0b538 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Close More Deals, Faster
          </span>
        </h1>

        <p className="text-xl md:text-2xl mb-10 max-w-3xl leading-relaxed" style={{ color: '#888888' }}>
          REIblast is the wholesale operating system built for investors who text. Pipeline,
          sequences, contracts, and deal analysis — all in one place.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/signup"
            className="bg-gold text-black font-bold text-lg px-8 py-4 rounded-xl hover:bg-gold-hover transition-colors"
            style={{ fontWeight: 700 }}
          >
            Get Started — $57/mo
          </Link>
          <a
            href="#features"
            className="border border-gold text-gold font-semibold text-lg px-8 py-4 rounded-xl hover:bg-gold/10 transition-colors"
          >
            See How It Works
          </a>
        </div>

        <p className="mt-8 text-sm" style={{ color: '#888888' }}>
          No contracts. Cancel anytime.
        </p>
      </div>
    </section>
  )
}
