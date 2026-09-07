"use client";

import { useState } from "react";
import Link from "next/link";

const BILLING_FAQS = [
  {
    q: "What does my $57/month membership cover?",
    a: (
      <>
        The REIblast platform: CRM, pipeline, SMS sequences, contracts and
        e-signature, deal analyzer, lead cleaner, and support. It does not
        include telecom costs (phone numbers, A2P, or message/call usage),
        which are billed separately as pass-through.
      </>
    ),
  },
  {
    q: "What do I have to pay for on top of my membership?",
    a: (
      <>
        Phone number(s) at $1.265/number/month, a one-time A2P registration
        fee of $23.50, an A2P monthly carrier fee ($2.10 for sole proprietors
        / $10.50 for LLC/EIN), and usage (texts, calls, emails) at the posted
        rates. These are billed from your wallet balance.
      </>
    ),
  },
  {
    q: "Why am I being charged for texts and phone numbers?",
    a: (
      <>
        Those are carrier/telecom pass-through costs, not markup. Every
        message segment and phone number has a real cost from the carrier,
        billed as usage from your wallet on top of your flat membership.
      </>
    ),
  },
  {
    q: "How is my monthly cost estimated?",
    a: (
      <>
        Use the &ldquo;Calculate my costs&rdquo; estimator to see a daily and
        3-month projection based on your expected usage. It&apos;s an
        estimate — actual costs vary with real usage.
      </>
    ),
  },
];

const A2P_FAQS = [
  {
    q: "Do I need an LLC to get started?",
    a: (
      <>
        No. You can wholesale deals as a sole proprietor and form your LLC
        once you&apos;re actually closing deals. There&apos;s no need to delay
        signing up while you handle that paperwork — though an LLC/EIN does
        unlock higher A2P limits, see below.
      </>
    ),
  },
  {
    q: "What is A2P and why do I need it?",
    a: (
      <>
        A2P (application-to-person) is the carrier registration that lets you
        legally send business texts. It&apos;s required by mobile carriers
        before any blasting; unregistered sending gets blocked or filtered.
      </>
    ),
  },
  {
    q: "Do I need an EIN or LLC?",
    a: (
      <>
        You can start as a sole proprietor without an EIN, but it changes
        your limits and fees: sole proprietors are capped at 3,000
        segments/day on a single phone number with a $2.10/mo A2P fee, while
        an LLC/EIN allows up to 6,000 segments/day, unlimited phone numbers,
        and a $10.50/mo A2P fee.
      </>
    ),
  },
  {
    q: "How long does A2P registration take?",
    a: (
      <>
        Typically two to three business days after submission. You can
        register as a sole proprietor with accurate business information, or
        with an LLC/EIN for higher limits — see above.
      </>
    ),
  },
  {
    q: "How does message ramp-up work?",
    a: (
      <>
        New accounts start at 500 segments/day and step up (500 → 750 → 1,000
        → 1,500 → 2,000 → 3,500 → 5,000 → your ceiling) each day you hit your
        limit, until you reach your target or your account cap. This protects
        deliverability.
      </>
    ),
  },
];

function FaqItem({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 text-left px-6 py-5"
      >
        <span className="text-white font-bold text-[17px]">{q}</span>
        <svg
          className={`w-4 h-4 text-gold shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <p className="text-white/70 text-[17px] leading-[1.85] px-6 pb-6">
          {a}
        </p>
      )}
    </div>
  );
}

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <section className="py-24 px-6 text-center bg-surface">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
          FAQ
        </p>
        <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight mb-5">
          Frequently Asked Questions
        </h1>
        <p className="text-white/60 text-lg leading-[1.75] max-w-xl mx-auto">
          Straight answers, from someone who has run this business himself.
        </p>
      </section>

      {/* FAQ list */}
      <section className="py-16 px-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
            Billing &amp; Charges
          </p>
          <div className="flex flex-col gap-4 mb-12">
            {BILLING_FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>

          <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
            A2P &amp; Compliance
          </p>
          <div className="flex flex-col gap-4">
            {A2P_FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>

          <p className="text-white/40 text-sm text-center mt-10">
            Still have a question?{" "}
            <Link
              href="/contact"
              className="text-gold hover:text-gold-hover underline underline-offset-4 transition-colors"
            >
              Contact us
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
