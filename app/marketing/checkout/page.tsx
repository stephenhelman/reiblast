"use client";

import { useState } from "react";
import { LogoFull } from "@/components/shared/Logo";

const CORE_FEATURES = [
  "Pre-built wholesale pipeline",
  "Locked SMS sequences",
  "Universal wholesale contracts",
  "Built-in e-signature",
  "Deal analyzer with MAO calculator (BETA)",
  "JV deal submission network",
  "Dedicated tools portal",
  "New tools added monthly",
];

const COMING_SOON = [
  {
    name: "AI Acquisitions Bot",
    description:
      "NEPQ-trained AI that qualifies sellers and books appointments via SMS, automatically.",
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

const CORE_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL_CORE ?? "#";

function CheckCircle() {
  return (
    <div className="w-7 h-7 rounded-full border-2 bg-gold border-gold flex items-center justify-center shrink-0">
      <svg
        className="w-4 h-4 text-black"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

export default function CheckoutPage() {
  const [coreExpanded, setCoreExpanded] = useState(true);

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
                    <p className="text-white font-bold text-xl">
                      REIblast Core
                    </p>
                    <p className="text-white/50 text-sm mt-0.5">
                      Your complete wholesale operating system.
                    </p>
                    <p className="text-gold font-semibold mt-2">
                      $57
                      <span className="text-white/40 font-normal text-sm">
                        /mo
                      </span>
                    </p>
                    <p className="text-gold/80 text-sm font-medium mt-1">
                      1 week free, then $57/mo
                    </p>
                  </div>
                  <CheckCircle />
                </div>

                <button
                  onClick={() => setCoreExpanded((v) => !v)}
                  className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mt-4 transition-colors"
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${coreExpanded ? "rotate-180" : ""}`}
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
                  {coreExpanded ? "Hide features" : "Show features"}
                </button>

                {coreExpanded && (
                  <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                    {CORE_FEATURES.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2 text-sm text-white/70"
                      >
                        <span className="text-gold mt-0.5 shrink-0">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Coming soon — static display only */}
              {COMING_SOON.map((item) => (
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
                  <p className="text-white/50 text-sm mt-0.5">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — order summary */}
          <div className="lg:sticky lg:top-24">
            <div className="bg-surface border border-gold/40 rounded-2xl p-7">
              <h2 className="text-white font-bold text-lg mb-5">
                Order Summary
              </h2>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-white/70 text-sm">REIblast Core</span>
                  <span className="text-white text-sm font-medium">$57/mo</span>
                </div>
              </div>

              <div className="border-t border-white/10 my-5" />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/50 text-xs uppercase tracking-wide">
                    Due today
                  </span>
                  <span className="text-white font-bold">$0</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50 text-xs uppercase tracking-wide">
                    Then monthly
                  </span>
                  <span className="text-white font-bold">$57/mo</span>
                </div>
              </div>
              <p className="text-gold text-xs text-center mt-3 font-medium">
                1 week free. Cancel before your trial ends and you won&apos;t
                be charged.
              </p>

              <button
                onClick={() => {
                  window.location.href = CORE_URL;
                }}
                className="mt-6 w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors"
              >
                Start My Free Week →
              </button>

              <p className="text-white/30 text-xs text-center mt-3">
                🔒 Secure checkout via Authorize.net
              </p>
              <p className="text-white/30 text-xs text-center mt-1">
                Cancel anytime. No long-term contracts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
