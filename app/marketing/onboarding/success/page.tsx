'use client'

import { SUPPORT_EMAIL } from '@/lib/constants'

const STEPS = [
  {
    n: 1,
    title: "We'll review your details within 24 hours",
    body: "Our team will verify your business information before setting up your workspace.",
  },
  {
    n: 2,
    title: "You'll receive an email with your CRM login credentials",
    body: "Check your inbox — login details will arrive once your account is ready.",
  },
  {
    n: 3,
    title: "Get your first list ready on DealMachine while you wait",
    body: "Have a list pulled and ready so you can blast your market on day one.",
  },
]

export default function OnboardingSuccessPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center py-16 px-4">
      <div className="max-w-lg w-full text-center">
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

        <h1 className="text-3xl font-bold mb-3">
          You&apos;re all set — we&apos;re reviewing your information
        </h1>
        <p className="text-white/50 text-lg mb-10">
          Your onboarding form has been received.
        </p>

        <div className="space-y-4 mb-10 text-left">
          {STEPS.map(({ n, title, body }) => (
            <div key={n} className="flex gap-4 bg-surface border border-border-default rounded-xl p-5">
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
