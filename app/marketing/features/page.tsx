'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'

// ─── Fade-up animation wrapper ───────────────────────────────────────────────

function FadeUp({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(28px)',
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

// ─── Feature data ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: '⚡',
    badge: 'PIPELINE',
    headline: 'The Pipeline Ari Closes 5-6 Deals a Month With',
    body: 'The pipeline Ari uses on a monthly basis to close his deals. No guessing. Just a proven process — already loaded into your CRM the moment you sign up.',
    accent: 'gold' as const,
    comingSoon: false,
  },
  {
    icon: '📱',
    badge: 'SMS SEQUENCES',
    headline: 'The Exact Texts That Get Sellers to Respond',
    body: "The exact SMS sequences Ari uses every single day when he text blasts motivated sellers. Don't know what to say? We got you. Loaded, locked, and ready to fire.",
    accent: 'gold' as const,
    comingSoon: false,
  },
  {
    icon: '📄',
    badge: 'CONTRACTS',
    headline: 'Stop Searching for a Contract',
    body: 'Integrated directly into REIblast. Fill in a couple of fields and send the contract. No downloading, no uploading, no wondering if you have the right one.',
    accent: 'gold' as const,
    comingSoon: false,
  },
  {
    icon: '✍️',
    badge: 'E-SIGNATURE',
    headline: 'Which E-Sign Should You Use? None of the Above.',
    body: "DocuSign, Dropbox, PandaDoc, RabbitSign — how about none of the above. REIblast has e-signature built in. Send a contract for signature without ever leaving your dashboard.",
    accent: 'gold' as const,
    comingSoon: false,
  },
  {
    icon: '🧮',
    badge: 'DEAL ANALYZER',
    headline: 'Real Comps. Real Numbers. Real Fast.',
    body: "Don't go to Zillow looking for comps. The deal analyzer pulls real sold data, analyzes your deal with AI, runs your numbers, and saves everything directly to REIblast.",
    accent: 'gold' as const,
    comingSoon: false,
  },
  {
    icon: '🧹',
    badge: 'LEAD CLEANER',
    headline: 'Mobile Only. Every Time.',
    body: 'Need to scrub a list? The lead cleaner strips out landlines, VoIP, and anything else that tanks your delivery rate. Upload your BatchLeads export and push clean mobile-only contacts straight to your CRM.',
    accent: 'gold' as const,
    comingSoon: false,
  },
  {
    icon: '🤝',
    badge: 'COMING SOON',
    headline: 'Got a Deal? Submit it to the Network.',
    body: "Connect with Ari's buyer network directly from REIblast. Submit your deal, upload your contract, and let the network work for you.",
    accent: 'gray' as const,
    comingSoon: true,
  },
]

const MENTORSHIP_URL = process.env.NEXT_PUBLIC_MENTORSHIP_URL || '#'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-black">

      {/* Page header */}
      <section className="bg-surface py-24 px-6 text-center">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">THE SYSTEM</p>
        <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
          Everything You Need.<br />Nothing You Don&apos;t.
        </h1>
        <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
          REIblast is built around one thing — getting you from list to closed deal as fast as possible.
        </p>
      </section>

      {/* Alternating feature blocks */}
      <div>
        {FEATURES.map((f, i) => {
          const isEven = i % 2 === 0
          const opacity = f.comingSoon ? 'opacity-65' : ''

          return (
            <section
              key={f.badge}
              className={`py-20 px-6 border-b border-border-default ${opacity}`}
            >
              <FadeUp delay={100}>
                <div className="max-w-6xl mx-auto">
                  <div className={`flex flex-col md:flex-row items-center gap-12 ${!isEven ? 'md:flex-row-reverse' : ''}`}>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-5">
                        <span
                          className="text-xs font-bold px-3 py-1 rounded-full border"
                          style={{
                            borderColor: f.comingSoon ? 'rgba(255,255,255,0.2)' : 'rgba(245,200,66,0.4)',
                            color: f.comingSoon ? 'rgba(255,255,255,0.4)' : '#F5C842',
                          }}
                        >
                          {f.badge}
                        </span>
                        {f.comingSoon && (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/5 text-white/30 border border-white/10">
                            Coming Soon
                          </span>
                        )}
                      </div>

                      <h2
                        className="text-3xl md:text-4xl font-extrabold leading-tight mb-5"
                        style={{ color: f.comingSoon ? 'rgba(255,255,255,0.5)' : '#ffffff' }}
                      >
                        {f.headline}
                      </h2>

                      <p className="text-lg leading-relaxed" style={{ color: f.comingSoon ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)' }}>
                        {f.body}
                      </p>
                    </div>

                    {/* Icon */}
                    <div
                      className="shrink-0 w-40 h-40 rounded-3xl flex items-center justify-center text-7xl border"
                      style={{
                        background: f.comingSoon ? 'rgba(255,255,255,0.02)' : 'rgba(245,200,66,0.06)',
                        borderColor: f.comingSoon ? 'rgba(255,255,255,0.08)' : 'rgba(245,200,66,0.2)',
                      }}
                    >
                      {f.icon}
                    </div>
                  </div>
                </div>
              </FadeUp>
            </section>
          )
        })}
      </div>

      {/* Disclaimer */}
      <section className="bg-surface border-t border-border-default px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-white/30 text-sm leading-[1.8]">
            * Individual results may vary. REIblast provides tools and systems based on Ari&apos;s personal wholesale experience.
            Success depends on your market, effort, and execution. The wholesale contract included is a general-purpose template
            and has not been reviewed for your specific state or jurisdiction. We recommend having a local real estate attorney
            review any contract before use.
            <br /><br />
            An active LLC and EIN are required to sign up for REIblast.
          </p>
        </div>
      </section>

      {/* Resources */}
      <section className="px-6 py-12 bg-surface border-b border-border-default">
        <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-6">
          <div className="bg-black border border-border-default rounded-xl p-6">
            <div className="text-3xl mb-3">🏢</div>
            <p className="text-white font-semibold mb-1">Need an LLC?</p>
            <p className="text-white/50 text-sm mb-4 leading-relaxed">We can point you in the right direction.</p>
            <a href="mailto:support@reiblast.app" className="text-gold text-sm font-semibold hover:text-gold-hover transition-colors">
              Contact Us →
            </a>
          </div>
          <div className="bg-black border border-border-default rounded-xl p-6">
            <div className="text-3xl mb-3">🤝</div>
            <p className="text-white font-semibold mb-1">Need help closing your first deal?</p>
            <p className="text-white/50 text-sm mb-4 leading-relaxed">
              Ari offers 1-on-1 mentorship to get you to your first deal in 30 days.
            </p>
            <a
              href={MENTORSHIP_URL}
              target="_blank"
              rel="noreferrer"
              className="text-gold text-sm font-semibold hover:text-gold-hover transition-colors"
            >
              Book a Session with Ari →
            </a>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-6 text-center">
        <h2 className="text-4xl font-bold text-white mb-8">Ready to get started?</h2>
        <Link
          href="/checkout"
          className="inline-block bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
        >
          Get Started — $79/mo
        </Link>
      </section>
    </div>
  )
}
