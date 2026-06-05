'use client'

import { useState } from 'react'
import { LogoFull } from '@/components/shared/Logo'

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

const A2P_FEATURES = [
  'Custom domain purchase and setup',
  'Cloudflare DNS configuration',
  'A2P compliance website',
  'Brand and campaign registration',
  'Email sending domain setup',
]

const COMING_SOON = [
  {
    name: 'AI Acquisitions Bot',
    description: 'NEPQ-trained AI that qualifies sellers and books appointments via SMS — automatically.',
  },
  {
    name: 'AI Dispositions Bot',
    description: 'Blast your deals to cash buyers and manage responses automatically.',
  },
  {
    name: 'State Contract Bundle',
    description: 'Attorney-reviewed purchase and assignment contracts for the top 10 wholesale markets.',
  },
  {
    name: 'Ask Ari AI',
    description: 'Wish you had an experienced wholesaler over your shoulder? Ask Ari AI is here to help. Available 24/7.',
  },
]

const BUNDLE_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL_BUNDLE ?? '#'
const CORE_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL_CORE ?? '#'

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <div
      className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
        checked ? 'bg-gold border-gold' : 'border-white/30 bg-transparent'
      }`}
    >
      {checked && (
        <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </div>
  )
}

function WarningModal({
  onAddA2P,
  onContinue,
}: {
  onAddA2P: () => void
  onContinue: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-gold/30 rounded-2xl p-9 max-w-120 w-full">
        <p className="text-5xl text-center mb-4">⚠️</p>
        <h2 className="text-white font-bold text-2xl text-center mb-4">Are you sure?</h2>
        <p className="text-white/60 text-center leading-[1.7] text-sm">
          Without A2P registration your texts won&apos;t be delivered to motivated sellers.
          It&apos;s required by all major carriers and typically takes 2-4 weeks to approve.
          <br />
          <br />
          Most members add it now to avoid delays when they&apos;re ready to blast.
        </p>
        <div className="mt-6 space-y-3">
          <button
            onClick={onAddA2P}
            className="w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors"
          >
            Add A2P Setup — +$100 →
          </button>
          <button
            onClick={onContinue}
            className="w-full border border-white/20 text-white/70 font-semibold py-3.5 rounded-xl hover:border-white/40 hover:text-white transition-colors"
          >
            Continue without A2P
          </button>
        </div>
        <p className="text-white/30 text-xs text-center mt-4">
          You can add A2P setup later from your member dashboard.
        </p>
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  const [a2pSelected, setA2pSelected] = useState(true)
  const [showWarning, setShowWarning] = useState(false)
  const [coreExpanded, setCoreExpanded] = useState(true)
  const [a2pExpanded, setA2pExpanded] = useState(false)

  function handleCheckout() {
    if (!a2pSelected) {
      setShowWarning(true)
      return
    }
    window.location.href = BUNDLE_URL
  }

  return (
    <div className="min-h-screen bg-black px-6 py-12">
      <div className="max-w-275 mx-auto">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-12">
          <LogoFull size={28} />
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mt-6 mb-3">
            Complete Your Order
          </h1>
          <p className="text-white/50 text-lg">
            Everything you need to start closing wholesale deals.
          </p>
        </div>

        {/* Two-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
          {/* LEFT — product selection */}
          <div>
            <p className="text-gold text-xs font-bold uppercase tracking-widest mb-5">
              Your Order
            </p>

            <div className="space-y-4">
              {/* Core — always included */}
              <div className="bg-surface border-l-4 border-l-gold border border-gold/30 rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="mb-2">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gold text-black">
                        INCLUDED
                      </span>
                    </div>
                    <p className="text-white font-bold text-xl">REIblast Core</p>
                    <p className="text-white/50 text-sm mt-0.5">Your complete wholesale operating system.</p>
                    <p className="text-gold font-semibold mt-2">
                      $79<span className="text-white/40 font-normal text-sm">/mo</span>
                    </p>
                  </div>
                  <CheckCircle checked={true} />
                </div>

                <button
                  onClick={() => setCoreExpanded(v => !v)}
                  className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mt-4 transition-colors"
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${coreExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  {coreExpanded ? 'Hide features' : 'Show features'}
                </button>

                {coreExpanded && (
                  <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                    {CORE_FEATURES.map(f => (
                      <li key={f} className="flex items-start gap-2 text-sm text-white/70">
                        <span className="text-gold mt-0.5 shrink-0">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* A2P — selected by default, toggleable */}
              <div
                className={`rounded-xl border p-6 transition-all cursor-pointer ${
                  a2pSelected
                    ? 'border-gold bg-surface shadow-[0_0_20px_rgba(245,200,66,0.08)]'
                    : 'border-white/10 bg-surface hover:border-white/25'
                }`}
                onClick={() => setA2pSelected(v => !v)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="mb-2">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full border border-gold text-gold">
                        ADD-ON
                      </span>
                    </div>
                    <p className="text-white font-bold text-lg">A2P Done-For-You Setup</p>
                    <p className="text-white/50 text-sm mt-0.5">Required to send SMS. We handle everything.</p>
                    <p className="text-gold font-semibold mt-2">
                      $100<span className="text-white/40 font-normal text-sm"> one-time</span>
                    </p>
                  </div>
                  <CheckCircle checked={a2pSelected} />
                </div>

                {!a2pSelected && (
                  <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                    <span className="shrink-0 text-amber-400 text-sm">⚠</span>
                    <p className="text-amber-300/80 text-xs leading-relaxed">
                      Without A2P registration your texts won&apos;t be delivered to motivated sellers.
                      It&apos;s required by all major carriers and takes 2-4 weeks to approve. Most
                      members add it now to avoid delays.
                    </p>
                  </div>
                )}

                <button
                  onClick={e => {
                    e.stopPropagation()
                    setA2pExpanded(v => !v)
                  }}
                  className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mt-4 transition-colors"
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${a2pExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  {a2pExpanded ? 'Hide features' : 'Show features'}
                </button>

                {a2pExpanded && (
                  <ul className="mt-3 space-y-1.5">
                    {A2P_FEATURES.map(f => (
                      <li key={f} className="flex items-start gap-2 text-sm text-white/70">
                        <span className="text-gold mt-0.5 shrink-0">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Coming soon — static display only */}
              {COMING_SOON.map(item => (
                <div
                  key={item.name}
                  className="opacity-50 cursor-not-allowed rounded-xl border border-white/10 bg-surface p-6"
                >
                  <div className="mb-2">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full border border-white/20 text-white/40">
                      COMING SOON
                    </span>
                  </div>
                  <p className="text-white font-bold text-lg">{item.name}</p>
                  <p className="text-white/50 text-sm mt-0.5">{item.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — order summary */}
          <div className="lg:sticky lg:top-24">
            <div className="bg-surface border border-gold/40 rounded-2xl p-7">
              <h2 className="text-white font-bold text-lg mb-5">Order Summary</h2>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-white/70 text-sm">REIblast Core</span>
                  <span className="text-white text-sm font-medium">$79/mo</span>
                </div>
                {a2pSelected && (
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-sm">A2P Done-For-You Setup</span>
                    <span className="text-white text-sm font-medium">$100 one-time</span>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 my-5" />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/50 text-xs uppercase tracking-wide">Due today</span>
                  <span className="text-white font-bold">${a2pSelected ? 179 : 79}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50 text-xs uppercase tracking-wide">Then monthly</span>
                  <span className="text-white font-bold">$79/mo</span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                className="mt-6 w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors"
              >
                Complete Order →
              </button>

              <p className="text-white/30 text-xs text-center mt-3">🔒 Secure checkout via Stripe</p>
              <p className="text-white/30 text-xs text-center mt-1">
                Cancel anytime. No long-term contracts.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showWarning && (
        <WarningModal
          onAddA2P={() => {
            setA2pSelected(true)
            setShowWarning(false)
          }}
          onContinue={() => {
            window.location.href = CORE_URL
          }}
        />
      )}
    </div>
  )
}
