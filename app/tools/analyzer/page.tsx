'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MinimalHeader from '@/components/tools/MinimalHeader'

function AnalyzerContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  function goToSFR() {
    const dest = token ? `/analyzer/sfr?token=${token}` : '/analyzer/sfr'
    router.push(dest)
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MinimalHeader title="Deal Analyzer" />
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold mb-2">What are you analyzing?</h1>
          <p className="text-white/40 text-sm">Choose a property type to get started.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Single Family */}
          <button
            onClick={goToSFR}
            className="group bg-surface border border-border-default hover:border-gold rounded-2xl p-8 text-left transition-all duration-200 hover:bg-surface-2"
          >
            <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center mb-5 group-hover:bg-gold/20 transition-colors">
              <svg className="w-6 h-6 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <h2 className="text-white font-bold text-lg mb-1">Single Family</h2>
            <p className="text-white/40 text-sm mb-6 leading-relaxed">
              ARV analysis, repair tiers, MAO calculator
            </p>
            <span className="inline-flex items-center gap-1.5 bg-gold text-black text-sm font-bold px-4 py-2 rounded-lg group-hover:bg-gold-hover transition-colors">
              Start analysis
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>

          {/* Land — disabled / coming soon */}
          <div className="relative bg-surface border border-border-default rounded-2xl p-8 opacity-50 cursor-not-allowed select-none">
            <span className="absolute top-4 right-4 bg-white/10 text-white/50 text-xs font-semibold px-2.5 py-1 rounded-full">
              Coming soon
            </span>
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-5">
              <svg className="w-6 h-6 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h8m-8 4h4" />
              </svg>
            </div>
            <h2 className="text-white font-bold text-lg mb-1">Land</h2>
            <p className="text-white/40 text-sm mb-6 leading-relaxed">
              Comparable land sales, price per acre, zoning analysis
            </p>
            <span className="inline-flex items-center gap-1.5 bg-white/10 text-white/30 text-sm font-bold px-4 py-2 rounded-lg">
              Coming soon
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AnalyzerPage() {
  return (
    <Suspense>
      <AnalyzerContent />
    </Suspense>
  )
}
