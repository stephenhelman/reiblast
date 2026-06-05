import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About — REIblast',
  description: 'Built by a wholesaler, for wholesalers. Meet Ari and the story behind REIblast.',
}

const MENTORSHIP_URL = process.env.NEXT_PUBLIC_MENTORSHIP_URL || '#'

const STATS = [
  { number: '22', label: 'Years old' },
  { number: '5-6', label: 'Deals closed per month' },
  { number: '100%', label: 'Text blast. No cold calls.' },
]

const METHOD = [
  {
    icon: '📋',
    title: 'Pull a List',
    body: 'Source motivated seller leads from DealMachine. Skip trace with BatchLeads. Clean with the Lead Cleaner. Import to REIblast in minutes.',
  },
  {
    icon: '💬',
    title: 'Blast the Market',
    body: "Load the list. Fire Ari's battle-tested SMS sequences. Let the system follow up automatically while you focus on the responses.",
  },
  {
    icon: '🏠',
    title: 'Close the Deal',
    body: 'Analyze the deal. Run the numbers. Send the contract. Get it signed. Assign it. Repeat.',
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-black">

      {/* Header */}
      <section className="py-24 px-6 text-center bg-surface">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">ABOUT</p>
        <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight">
          Built by a Wholesaler,<br />For Wholesalers
        </h1>
      </section>

      {/* Stats */}
      <section className="py-16 px-6 border-y border-border-default">
        <div className="max-w-2xl mx-auto grid grid-cols-3 gap-6">
          {STATS.map((s) => (
            <div
              key={s.number}
              className="bg-surface border border-border-default rounded-xl p-6 text-center"
            >
              <div className="text-5xl font-bold text-gold mb-2">{s.number}</div>
              <p className="text-white/60 text-sm">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Story */}
      <section className="py-16 px-6">
        <div className="max-w-2xl mx-auto" style={{ maxWidth: 680 }}>
          <p className="text-white/70 text-lg leading-[1.85] mb-6">
            Ari started wholesaling in his early 20s out of Houston, TX. While most investors were cold
            calling, door knocking, and paying for expensive lead generation services, Ari kept it simple
            — build a list, text blast it, close the deal.
          </p>
          <p className="text-white/70 text-lg leading-[1.85] mb-6">
            That system now closes him 5-6 deals a month. Consistently.
          </p>
          <p className="text-white/70 text-lg leading-[1.85] mb-6">
            The problem was the tools. Every part of the process lived in a different app. DealMachine for
            lists. BatchLeads for skip tracing. A random CRM for contacts. ChatGPT for cleaning data. A
            separate contract tool. A separate e-sign tool.
          </p>
          <p className="text-white/70 text-lg leading-[1.85] mb-6">
            It was a mess — and it was slowing down his students.
          </p>
          <p className="text-white/70 text-lg leading-[1.85]">
            REIblast is what he wished existed when he started. One system. His exact pipeline, his exact
            sequences, his contracts — all in one place. Built for investors who text.
          </p>
        </div>
      </section>

      {/* The Method */}
      <section className="bg-surface border-y border-border-default px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">THE METHOD</p>
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              No Cold Calls.<br />No Zillow. Just Texts.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {METHOD.map((m) => (
              <div
                key={m.title}
                className="bg-black border border-border-default rounded-xl p-7"
              >
                <div className="text-3xl mb-4">{m.icon}</div>
                <h3 className="text-white font-bold text-lg mb-3">{m.title}</h3>
                <p className="text-white/60 text-sm leading-[1.75]">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mentorship */}
      <section className="py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto" style={{ maxWidth: 680 }}>
          <h2 className="text-4xl font-bold text-white mb-5">Want Ari in Your Corner?</h2>
          <p className="text-white/60 text-lg leading-[1.75] mb-10">
            Ari mentors students one-on-one with one goal — get you to your first deal in 30 days. If you
            want his personal guidance on top of the REIblast system, book a session directly.
          </p>
          <a
            href={MENTORSHIP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-block bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors mb-5"
          >
            Book a Session with Ari →
          </a>
          <div>
            <a
              href="mailto:support@reiblast.app"
              className="text-white/40 text-sm hover:text-white/70 transition-colors"
            >
              Questions first? support@reiblast.app
            </a>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-6 text-center border-t border-border-default">
        <h2 className="text-4xl font-bold text-white mb-8">
          Ready to build your wholesale business?
        </h2>
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
