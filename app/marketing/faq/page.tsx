"use client";

import { useState } from "react";
import Link from "next/link";

const FAQS = [
  {
    q: "Do I need an LLC to get started?",
    a: (
      <>
        No. You can wholesale deals as a sole proprietor and form your LLC
        once you&apos;re actually closing deals. There&apos;s no need to delay
        signing up while you handle that paperwork.
      </>
    ),
  },
  {
    q: "How long does A2P registration take?",
    a: (
      <>
        Typically two to three business days after submission. It requires
        accurate business information, but not an LLC or EIN.
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
          <div className="flex flex-col gap-4">
            {FAQS.map((f) => (
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
