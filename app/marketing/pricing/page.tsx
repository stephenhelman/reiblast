import type { Metadata } from 'next'
import Link from 'next/link'
import Pricing from '@/components/marketing/Pricing'

const CORE_FEATURES = [
  'Pre-built wholesale pipeline',
  'Locked SMS sequences',
  'Universal wholesale contracts',
  'Built-in e-signature',
  'Deal analyzer with MAO calculator',
  'JV deal submission network',
  'Dedicated tools portal',
  'New tools added monthly',
]

export const metadata: Metadata = {
  title: 'Pricing — REIblast',
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-black pt-24 pb-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-4">
            One plan. <span className="text-gold">Everything included.</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto">
            REIblast Core gives you every tool you need to run a wholesale operation at full speed.
          </p>
        </div>

        <Pricing />

        <div className="mt-20">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Everything in <span className="text-gold">Core</span>
          </h2>
          <div className="max-w-2xl mx-auto bg-surface border border-border-default rounded-xl p-8">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-8">
              {CORE_FEATURES.map((item) => (
                <li key={item} className="flex items-start gap-2 text-white/70 text-sm">
                  <svg className="w-4 h-4 text-gold shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-20 text-center bg-surface border border-gold/30 rounded-2xl p-12">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to close your first deal?</h2>
          <p className="text-white/50 mb-8 max-w-xl mx-auto">
            Join wholesalers who are running their entire operation inside REIblast.
          </p>
          <Link
            href="/checkout"
            className="inline-block bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
          >
            Get Started — $79/mo
          </Link>
          <p className="text-white/30 text-sm mt-4">No contracts. Cancel anytime.</p>
        </div>
      </div>
    </div>
  )
}
