import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing — REIblast",
  description:
    "Simple, transparent pricing. One plan. Everything included. Pay only for what you use.",
};

const MENTORSHIP_URL = process.env.NEXT_PUBLIC_MENTORSHIP_URL || "#";

const CORE_FEATURES = [
  "Pre-built wholesale pipeline",
  "Locked SMS sequences",
  "Universal wholesale contracts",
  "Built-in e-signature",
  "Deal analyzer with real comps (BETA)",
  "Lead cleaner (mobile-only import)",
];

const USAGE_RATES = [
  { icon: "📞", label: "Outbound Calls", rate: "$0.0154", unit: "per minute" },
  { icon: "📲", label: "Inbound Calls", rate: "$0.0094", unit: "per minute" },
  { icon: "💬", label: "Outbound Texts", rate: "$0.0091", unit: "per segment" },
  { icon: "✉️", label: "Emails", rate: "$0.0007", unit: "per email" },
];

const A2P_FEATURES = [
  "Custom domain purchase and setup",
  "Cloudflare DNS configuration",
  "A2P compliance website",
  "Brand and campaign registration",
  "Email sending domain setup",
];

const COMING_SOON_ADDONS = [
  {
    name: "AI Acquisitions Bot",
    description:
      "NEPQ-trained AI that qualifies sellers and books appointments via SMS — automatically.",
  },
  {
    name: "AI Dispositions Bot",
    description:
      "Blast your deals to cash buyers and manage responses automatically.",
  },
  {
    name: "State Contract Bundle",
    description:
      "Attorney-reviewed purchase and assignment contracts for the top 10 wholesale markets.",
  },
  {
    name: "Ask Ari AI",
    description:
      "Wish you had an experienced wholesaler over your shoulder? Ask Ari AI is here to help. Available 24/7.",
  },
];

function Checkmark() {
  return (
    <svg
      className="w-5 h-5 text-gold shrink-0 mt-0.5"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-gold text-xs font-bold uppercase tracking-widest text-center mb-2">
      {children}
    </p>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <section className="py-24 px-6 text-center bg-surface">
        <SectionLabel>PRICING</SectionLabel>
        <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-5">
          Simple, Transparent Pricing
        </h1>
        <p className="text-white/50 text-xl max-w-xl mx-auto">
          One plan. Everything included. Pay only for what you use.
        </p>
      </section>

      {/* Core plan card */}
      <section className="py-16 px-6">
        <div className="max-w-xl mx-auto relative">
          <div
            className="bg-surface rounded-2xl p-10 relative overflow-hidden"
            style={{ border: "2px solid #F5C842" }}
          >
            {/* Most popular badge */}
            <div className="absolute top-0 right-0 bg-gold text-black text-xs font-bold px-4 py-1.5 rounded-bl-xl">
              MOST POPULAR
            </div>

            {/* Plan name */}
            <p className="text-gold font-semibold text-sm uppercase tracking-wider mb-2">
              REIblast Core
            </p>

            {/* Price */}
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-6xl font-bold text-white">$79</span>
              <span className="text-xl text-white/50">/mo</span>
            </div>
            <p className="text-white/40 text-sm mb-6">Cancel anytime</p>

            <div className="border-t border-white/10 my-5" />

            {/* Feature list */}
            <ul className="space-y-3 mb-8">
              {CORE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <Checkmark />
                  <span className="text-white/80 text-sm">{f}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/checkout"
              className="block w-full bg-gold text-black font-bold text-center py-4 rounded-xl hover:bg-gold-hover transition-colors"
            >
              Get Started →
            </Link>
          </div>
        </div>
      </section>

      {/* Usage rates */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <SectionLabel>USAGE RATES</SectionLabel>
          <p className="text-white/50 text-center mb-10">
            Pay only for what you use. Billed to your account monthly.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {USAGE_RATES.map((r) => (
              <div
                key={r.label}
                className="bg-surface border border-border-default rounded-xl p-6 text-center"
              >
                <div className="text-3xl mb-3">{r.icon}</div>
                <p className="text-white/60 text-xs uppercase tracking-wider mb-2">
                  {r.label}
                </p>
                <p className="text-3xl font-bold text-gold">{r.rate}</p>
                <p className="text-white/40 text-sm mt-1">{r.unit}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/20 text-center mt-4">
            Usage rates are billed in addition to your monthly subscription.
            Rates subject to change.
          </p>
        </div>
      </section>

      {/* Add-ons */}
      <section className="py-16 px-6 border-t border-border-default">
        <div className="max-w-3xl mx-auto">
          <SectionLabel>ADD-ONS</SectionLabel>
          <p className="text-white/50 text-center mb-10">
            Enhance your REIblast experience.
          </p>

          {/* A2P card */}
          <div
            className="bg-surface rounded-2xl p-8 mb-6"
            style={{
              border: "1px solid #F5C842",
              maxWidth: 680,
              margin: "0 auto 24px",
            }}
          >
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-xl mb-2">
                  A2P Done-For-You Setup
                </p>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-2xl font-bold text-gold">$100</span>
                  <span className="text-white/40 text-sm">one-time</span>
                </div>
                <p className="text-white/60 text-sm leading-[1.7]">
                  Required to send SMS messages through REIblast. We handle
                  everything — domain setup, DNS configuration, compliance
                  website, and carrier registration.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {A2P_FEATURES.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-sm text-white/50"
                    >
                      <span className="text-gold mt-0.5 shrink-0">•</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="shrink-0 w-full md:w-auto">
                <Link
                  href="/checkout?a2p=true"
                  className="inline-block bg-gold text-black font-bold py-3 px-7 rounded-xl hover:bg-gold-hover transition-colors whitespace-nowrap"
                >
                  Add to REIblast →
                </Link>
              </div>
            </div>
          </div>

          {/* Coming soon add-ons */}
          <div
            className="grid md:grid-cols-2 gap-4"
            style={{ maxWidth: 680, margin: "0 auto" }}
          >
            {COMING_SOON_ADDONS.map((item) => (
              <div
                key={item.name}
                className="bg-surface border border-white/10 rounded-xl p-6 opacity-50 cursor-not-allowed"
              >
                <span className="text-xs font-bold px-2.5 py-1 rounded-full border border-white/20 text-white/40">
                  COMING SOON
                </span>
                <p className="text-white font-bold text-base mt-3 mb-1">
                  {item.name}
                </p>
                <p className="text-white/40 text-sm">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="bg-surface border-t border-border-default px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-white/30 text-sm leading-[1.8]">
            * Individual results may vary. REIblast provides tools and systems
            based on Ari&apos;s personal wholesale experience. Success depends
            on your market, effort, and execution. The wholesale contract
            included is a general-purpose template and has not been reviewed for
            your specific state or jurisdiction. We recommend having a local
            real estate attorney review any contract before use.
            <br />
            <br />
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
            <p className="text-white/50 text-sm mb-4 leading-relaxed">
              We can point you in the right direction.
            </p>
            <a
              href="mailto:support@mail.reiblast.app"
              className="text-gold text-sm font-semibold hover:text-gold-hover transition-colors"
            >
              Contact Us →
            </a>
          </div>
          <div className="bg-black border border-border-default rounded-xl p-6">
            <div className="text-3xl mb-3">🤝</div>
            <p className="text-white font-semibold mb-1">
              Need help closing your first deal?
            </p>
            <p className="text-white/50 text-sm mb-4 leading-relaxed">
              Ari offers 1-on-1 mentorship to get you to your first deal in 30
              days.
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
        <Link
          href="/checkout"
          className="inline-block bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
        >
          Get Started — $79/mo
        </Link>
      </section>
    </div>
  );
}
