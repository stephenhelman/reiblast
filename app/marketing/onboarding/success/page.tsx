'use client'

import Link from 'next/link'
import { GHL_APP_URL, SUPPORT_EMAIL } from '@/lib/constants'

const STEPS = [
  { n: 1, title: 'Check your email', body: 'Your login credentials are on their way to your inbox.' },
  { n: 2, title: 'Log in at app.reiblast.app', body: 'Use the credentials from your welcome email to access your CRM.' },
  { n: 3, title: 'Pull your first list', body: 'Have a DealMachine list ready to upload on day one.' },
]

export default function OnboardingSuccessPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center py-16 px-4">
      <div className="max-w-lg w-full text-center">
        {/* Animated checkmark */}
        <div className="flex justify-center mb-8">
          <div
            className="w-20 h-20 rounded-full bg-gold/10 border-2 border-gold flex items-center justify-center"
            style={{ animation: 'pop-in 0.5s cubic-bezier(0.22,1,0.36,1) forwards' }}
          >
            <svg
              className="w-10 h-10 text-gold"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ animation: 'draw-check 0.4s 0.3s ease forwards', strokeDasharray: 30, strokeDashoffset: 30 }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-3">You&apos;re in. Welcome to REIblast.</h1>
        <p className="text-white/50 text-lg mb-10">
          Your account is ready. Check your email for login credentials.
        </p>

        {/* Steps */}
        <div className="space-y-4 mb-10 text-left">
          {STEPS.map(({ n, title, body }) => (
            <div key={n} className="flex gap-4 bg-[#141414] border border-[#2A2A2A] rounded-xl p-5">
              <div className="w-8 h-8 rounded-full bg-gold text-black font-bold text-sm flex items-center justify-center shrink-0">
                {n}
              </div>
              <div>
                <p className="font-semibold text-white">{title}</p>
                <p className="text-white/40 text-sm mt-0.5">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <Link
          href={GHL_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-full bg-gold text-black font-bold py-4 px-8 rounded-xl text-lg hover:bg-[#e0b538] transition-colors mb-6"
        >
          Go to My CRM →
        </Link>

        <p className="text-white/30 text-sm">
          Questions? Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-gold hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>

      <style jsx>{`
        @keyframes pop-in {
          from { opacity: 0; transform: scale(0.6); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes draw-check {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}
