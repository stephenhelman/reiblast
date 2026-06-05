import type { Metadata } from "next";
import Link from "next/link";
import { LogoStacked } from "@/components/shared/Logo";

export const metadata: Metadata = {
  title: "Get Started — REIblast",
};

const checkoutUrl = process.env.NEXT_PUBLIC_CHECKOUT_URL;
if (!checkoutUrl) console.warn("NEXT_PUBLIC_CHECKOUT_URL is not set");
const paymentLink = checkoutUrl ?? "#";

const FEATURES = [
  "Pre-built CRM pipeline + A2P-compliant SMS sequences ready on day one",
  "Universal wholesale contract with built-in e-signature — no extra tools",
  "Deal analyzer (BETA), JV network, and lead sourcing all in one portal",
];

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 pt-16">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10">
          <Link href="/">
            <LogoStacked size={80} />
          </Link>
        </div>

        <div className="bg-surface border border-gold/30 rounded-2xl p-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-3">
            Ready to get started?
          </h1>
          <p className="text-white/50 mb-8">
            Everything you need to run your wholesale operation — one flat
            monthly price.
          </p>

          <ul className="space-y-4 text-left mb-10">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-gold/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg
                    className="w-3 h-3 text-gold"
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
                <span className="text-white/80 text-sm leading-relaxed">
                  {f}
                </span>
              </li>
            ))}
          </ul>

          <a
            href={paymentLink}
            className="block w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors"
          >
            Subscribe Now — $57/mo
          </a>

          <p className="text-white/30 text-xs mt-4">
            🔒 Powered by secure checkout
          </p>
        </div>

        <p className="text-white/30 text-sm text-center mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-gold hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

/*
 * ─── Phase 2: Full signup form (restore when ready) ────────────────────────────
 *
 * 'use client'
 *
 * import { useState, FormEvent } from 'react'
 * import Link from 'next/link'
 * import { LogoFull, LogoStacked } from '@/components/shared/Logo'
 * import Input from '@/components/shared/Input'
 * import Button from '@/components/shared/Button'
 * import { CORE_PRICE } from '@/lib/constants'
 *
 * const FEATURES = [
 *   'Pre-built wholesale CRM pipeline',
 *   'A2P-compliant SMS + locked sequences',
 *   'Universal wholesale contract + e-sign',
 *   'Deal analyzer with MAO calculator',
 *   'JV deal submission network',
 * ]
 *
 * export default function SignupPage() {
 *   const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
 *   const [errors, setErrors] = useState({})
 *   const [showPassword, setShowPassword] = useState(false)
 *   const [showConfirm, setShowConfirm] = useState(false)
 *   const [loading, setLoading] = useState(false)
 *   const [serverError, setServerError] = useState('')
 *
 *   // ... full form logic, validation, and two-column layout
 *   // POST to /api/auth/signup, redirect to NEXT_PUBLIC_TOOLS_URL on success
 * }
 */
