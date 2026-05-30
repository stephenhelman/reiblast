'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import MinimalHeader from '@/components/tools/MinimalHeader'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PropertyDetails {
  address: string
  city: string
  state: string
  zip: string
  beds: number
  baths: number
  sqft: number
  yearBuilt: number
  propertyType: string
  lastSaleDate: string
  lastSalePrice: number
  estimatedValue: number
  latitude: number
  longitude: number
}

interface Comp {
  id: string
  address: string
  city: string
  state: string
  beds: number
  baths: number
  sqft: number
  yearBuilt: number
  salePrice: number
  saleDate: string
  daysAgo: number
  pricePerSqft: number
  distance: number
}

interface ARVResult {
  arv: {
    low: number
    high: number
    estimate: number
    pricePerSqft: number
    confidence: 'high' | 'medium' | 'low'
    confidenceReason: string
  }
  repairs: {
    light: { low: number; high: number; description: string }
    medium: { low: number; high: number; description: string }
    heavy: { low: number; high: number; description: string }
  }
  mao: { light: number; medium: number; heavy: number }
  dealScore: 'strong' | 'borderline' | 'pass'
  dealScoreReason: string
  narrative: string
  bestComp: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) } catch { return s }
}

const LOADING_MSGS = [
  'Pulling comps data...',
  'Running ARV model...',
  'Calculating MAO...',
  'Scoring the deal...',
  'Almost done...',
]

// Declare Google Maps types for TypeScript
declare global {
  interface Window {
    google: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: { componentRestrictions: { country: string }; fields: string[] }
          ) => {
            addListener: (event: string, cb: () => void) => void
            getPlace: () => {
              formatted_address?: string
              geometry?: { location: { lat: () => number; lng: () => number } }
            }
          }
        }
      }
    }
    initGooglePlaces?: () => void
  }
}

// ─── Step components ─────────────────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-colors ${n === step ? 'bg-gold' : n < step ? 'bg-gold/40' : 'bg-white/10'}`} />
          {n < 4 && <div className={`w-8 h-px ${n < step ? 'bg-gold/40' : 'bg-white/10'}`} />}
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function AnalyzerContent() {
  const searchParams = useSearchParams()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _token = searchParams.get('token')

  const [step, setStep] = useState(1)
  const [address, setAddress] = useState('')
  const [property, setProperty] = useState<PropertyDetails | null>(null)
  const [comps, setComps] = useState<Comp[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [analysis, setAnalysis] = useState<ARVResult | null>(null)
  const [radius, setRadius] = useState(0.5)
  const [months, setMonths] = useState(6)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0)
  const [error, setError] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchingComps, setFetchingComps] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const acRef = useRef<InstanceType<typeof window.google.maps.places.Autocomplete> | null>(null)
  const latRef = useRef<number>(0)
  const lngRef = useRef<number>(0)

  // Load Google Places
  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
    if (!key) return

    window.initGooglePlaces = () => {
      if (!inputRef.current || !window.google) return
      acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address', 'geometry'],
      })
      acRef.current.addListener('place_changed', () => {
        const place = acRef.current!.getPlace()
        if (place.formatted_address) setAddress(place.formatted_address)
        if (place.geometry?.location) {
          latRef.current = place.geometry.location.lat()
          lngRef.current = place.geometry.location.lng()
        }
      })
    }

    if (!document.getElementById('gplaces-script')) {
      const script = document.createElement('script')
      script.id = 'gplaces-script'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=initGooglePlaces`
      script.async = true
      document.head.appendChild(script)
    } else if (window.google) {
      window.initGooglePlaces?.()
    }
  }, [])

  // Cycle loading messages
  useEffect(() => {
    if (!analyzing) return
    const t = setInterval(() => {
      setLoadingMsgIdx((i) => {
        const next = (i + 1) % LOADING_MSGS.length
        setLoadingMsg(LOADING_MSGS[next])
        return next
      })
    }, 2000)
    return () => clearInterval(t)
  }, [analyzing])

  async function handleLookup() {
    if (!address.trim()) return
    setError('')
    setFetching(true)
    try {
      const res = await fetch('/api/analyzer/property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Property not found')
        return
      }
      const data = await res.json()
      // Use coordinates from Google Places if Rentcast doesn't return them
      if (!data.latitude && latRef.current) data.latitude = latRef.current
      if (!data.longitude && lngRef.current) data.longitude = lngRef.current
      setProperty(data)
      setStep(2)
    } catch {
      setError('Failed to look up property. Try again.')
    } finally {
      setFetching(false)
    }
  }

  const fetchComps = useCallback(async (r: number, m: number) => {
    if (!property) return
    setFetchingComps(true)
    try {
      const res = await fetch('/api/analyzer/comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: property.address,
          latitude: property.latitude || latRef.current,
          longitude: property.longitude || lngRef.current,
          beds: property.beds,
          baths: property.baths,
          radius: r,
          months: m,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setComps(data)
        setSelectedIds(new Set())
      }
    } catch {
      // keep existing comps
    } finally {
      setFetchingComps(false)
    }
  }, [property])

  useEffect(() => {
    if (step === 3 && property) {
      fetchComps(radius, months)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  function handleFilterChange(r: number, m: number) {
    setRadius(r)
    setMonths(m)
    fetchComps(r, m)
  }

  function toggleComp(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < 6) {
        next.add(id)
      }
      return next
    })
  }

  async function handleAnalyze() {
    const selected = comps.filter((c) => selectedIds.has(c.id))
    if (selected.length < 3) return
    setAnalyzing(true)
    setLoadingMsg(LOADING_MSGS[0])
    setLoadingMsgIdx(0)
    setStep(4)
    try {
      const res = await fetch('/api/analyzer/arv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: property, comps: selected }),
      })
      if (res.ok) {
        setAnalysis(await res.json())
      } else {
        setAnalysis(null)
      }
    } catch {
      setAnalysis(null)
    } finally {
      setAnalyzing(false)
    }
  }

  function reset() {
    setStep(1)
    setAddress('')
    setProperty(null)
    setComps([])
    setSelectedIds(new Set())
    setAnalysis(null)
    setError('')
  }

  const selectedCount = selectedIds.size

  return (
    <div className="min-h-screen bg-black text-white">
      <MinimalHeader title="Deal Analyzer" />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <StepDots step={step} />

        {/* ── Step 1: Address ── */}
        {step === 1 && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">Enter the property address</h2>
            <p className="text-white/40 text-sm mb-8">We&apos;ll pull property data and recent sales comps.</p>
            <div className="relative mb-4">
              <input
                ref={inputRef}
                type="text"
                placeholder="123 Main St, Dallas TX"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                className="w-full bg-surface-2 text-white rounded-xl border border-border-default focus:border-gold px-5 py-4 text-base outline-none transition-colors placeholder:text-white/30"
              />
            </div>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <button
              onClick={handleLookup}
              disabled={fetching || !address.trim()}
              className="w-full bg-gold text-black font-bold py-4 rounded-xl text-base hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {fetching ? (
                <>
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Looking up...
                </>
              ) : (
                'Look Up Property →'
              )}
            </button>
          </div>
        )}

        {/* ── Step 2: Property Confirmation ── */}
        {step === 2 && property && (
          <div>
            <h2 className="text-lg font-bold mb-4">Is this the right property?</h2>
            <div className="bg-surface border border-gold rounded-xl p-6 mb-6">
              <p className="text-white text-lg font-bold mb-4">{property.address}</p>
              <div className="grid grid-cols-4 gap-4 mb-4">
                {[
                  ['Beds', property.beds],
                  ['Baths', property.baths],
                  ['Sqft', property.sqft?.toLocaleString()],
                  ['Year', property.yearBuilt],
                ].map(([label, val]) => (
                  <div key={label as string}>
                    <p className="text-gold text-xs uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-white font-semibold">{val ?? '—'}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm border-t border-border-default pt-4">
                {[
                  ['Type', property.propertyType],
                  ['Last Sale', fmtDate(property.lastSaleDate)],
                  ['Last Price', fmt(property.lastSalePrice)],
                  ['Est. Value', fmt(property.estimatedValue)],
                ].map(([label, val]) => (
                  <div key={label as string}>
                    <p className="text-white/40 text-xs mb-0.5">{label}</p>
                    <p className="text-white">{val}</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setStep(3)}
              className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors mb-3"
            >
              This Is My Property →
            </button>
            <button onClick={reset} className="w-full text-white/40 text-sm py-2 hover:text-white transition-colors">
              ← Search Again
            </button>
          </div>
        )}

        {/* ── Step 3: Comp Selection ── */}
        {step === 3 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Select Comps</h2>
              <span className={`text-sm font-semibold ${selectedCount >= 3 ? 'text-gold' : 'text-white/30'}`}>
                {selectedCount} of 6 selected
              </span>
            </div>

            {/* Filters */}
            <div className="bg-surface rounded-lg p-3 flex gap-4 mb-4 flex-wrap">
              <div className="flex gap-1">
                {[0.25, 0.5, 1].map((r) => (
                  <button
                    key={r}
                    onClick={() => handleFilterChange(r, months)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${radius === r ? 'bg-gold text-black' : 'text-white/40 hover:text-white'}`}
                  >
                    {r}mi
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {[3, 6, 12].map((m) => (
                  <button
                    key={m}
                    onClick={() => handleFilterChange(radius, m)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${months === m ? 'bg-gold text-black' : 'text-white/40 hover:text-white'}`}
                  >
                    {m}mo
                  </button>
                ))}
              </div>
            </div>

            {fetchingComps ? (
              <div className="text-center py-12">
                <div className="inline-block w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              </div>
            ) : comps.length === 0 ? (
              <p className="text-white/30 text-center py-12 text-sm">No comps found. Try a larger radius or time period.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 pb-24">
                {comps.map((comp) => {
                  const selected = selectedIds.has(comp.id)
                  const maxed = selectedCount >= 6 && !selected
                  return (
                    <div
                      key={comp.id}
                      onClick={() => !maxed && toggleComp(comp.id)}
                      className={`bg-surface rounded-xl p-4 cursor-pointer transition-all relative ${
                        selected ? 'border border-gold' : maxed ? 'border border-border-default opacity-40' : 'border border-border-default hover:border-white/20'
                      }`}
                    >
                      <div className={`absolute top-3 right-3 w-4 h-4 rounded border-2 flex items-center justify-center ${selected ? 'bg-gold border-gold' : 'border-white/20'}`}>
                        {selected && (
                          <svg className="w-2.5 h-2.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <p className="text-white text-[13px] font-bold pr-6 leading-tight mb-2">{comp.address}</p>
                      <p className="text-gold text-lg font-bold mb-2">{fmt(comp.salePrice)}</p>
                      <p className="text-white/40 text-xs mb-1">{comp.beds}bd · {comp.baths}ba · {comp.sqft?.toLocaleString()} sqft</p>
                      <p className="text-white/30 text-xs">
                        {comp.pricePerSqft ? `$${comp.pricePerSqft}/sqft` : ''}{comp.distance != null ? ` · ${Number(comp.distance).toFixed(2)}mi` : ''} · sold {comp.daysAgo}d ago
                      </p>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Sticky bottom bar */}
            {selectedCount >= 3 && (
              <div className="fixed bottom-0 left-0 right-0 bg-black border-t border-border-default px-4 py-4 flex items-center justify-between gap-4">
                <span className="text-white/60 text-sm">{selectedCount} comps selected</span>
                <button
                  onClick={handleAnalyze}
                  className="bg-gold text-black font-bold px-6 py-3 rounded-xl hover:bg-gold-hover transition-colors"
                >
                  Analyze This Deal →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Results ── */}
        {step === 4 && (
          <div>
            {analyzing ? (
              <div className="text-center py-20">
                <div className="inline-block w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin mb-6" />
                <p className="text-gold text-sm font-medium">{loadingMsg}</p>
              </div>
            ) : !analysis ? (
              <div className="text-center py-20">
                <p className="text-red-400 mb-6">Analysis failed. Please try again.</p>
                <button onClick={() => setStep(3)} className="text-gold hover:underline text-sm">← Back to comps</button>
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                {/* ARV Card */}
                <div className="bg-surface border border-gold rounded-xl p-5">
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-2">After Repair Value</p>
                  <p className="text-white/50 text-sm mb-1">{fmt(analysis.arv.low)} — {fmt(analysis.arv.high)}</p>
                  <p className="text-white text-3xl font-bold mb-3">{fmt(analysis.arv.estimate)}</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-white/40">${analysis.arv.pricePerSqft}/sqft</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      analysis.arv.confidence === 'high' ? 'bg-green-400/10 text-green-400' :
                      analysis.arv.confidence === 'medium' ? 'bg-yellow-400/10 text-yellow-400' :
                      'bg-red-400/10 text-red-400'
                    }`}>
                      {analysis.arv.confidence} confidence
                    </span>
                  </div>
                  <p className="text-white/30 text-xs italic mt-2">{analysis.arv.confidenceReason}</p>
                </div>

                {/* Repair Tiers */}
                <div className="grid grid-cols-3 gap-3">
                  {(['light', 'medium', 'heavy'] as const).map((tier) => (
                    <div key={tier} className="bg-surface border border-border-default rounded-xl p-4">
                      <p className="text-white/40 text-xs uppercase tracking-wider mb-2">{tier} Rehab</p>
                      <p className="text-white/40 text-xs mb-2">{fmt(analysis.repairs[tier].low)} — {fmt(analysis.repairs[tier].high)}</p>
                      <p className="text-white/40 text-xs mb-1">MAO</p>
                      <p className="text-gold text-lg font-bold">{fmt(analysis.mao[tier])}</p>
                      <p className="text-white/20 text-xs mt-2 leading-tight">{analysis.repairs[tier].description}</p>
                    </div>
                  ))}
                </div>

                {/* Deal Score */}
                <div className={`rounded-xl p-5 border ${
                  analysis.dealScore === 'strong' ? 'bg-green-400/10 border-green-400/30' :
                  analysis.dealScore === 'borderline' ? 'bg-yellow-400/10 border-yellow-400/30' :
                  'bg-red-400/10 border-red-400/30'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">
                      {analysis.dealScore === 'strong' ? '🟢' : analysis.dealScore === 'borderline' ? '🟡' : '🔴'}
                    </span>
                    <span className={`font-bold text-lg capitalize ${
                      analysis.dealScore === 'strong' ? 'text-green-400' :
                      analysis.dealScore === 'borderline' ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {analysis.dealScore === 'strong' ? 'Strong Deal' : analysis.dealScore === 'borderline' ? 'Borderline' : 'Pass'}
                    </span>
                  </div>
                  <p className="text-white/60 text-sm">{analysis.dealScoreReason}</p>
                </div>

                {/* Narrative */}
                <div className="bg-surface border border-border-default rounded-xl p-5">
                  <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Analysis</p>
                  <p className="text-white text-sm leading-relaxed">{analysis.narrative}</p>
                  <p className="text-white/30 text-xs mt-3">Strongest comp: {analysis.bestComp}</p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-3 pt-2">
                  <Link
                    href={`/jv?address=${encodeURIComponent(property?.address || '')}&arv=${analysis.arv.estimate}&mao=${analysis.mao.medium}&score=${analysis.dealScore}`}
                    className="flex items-center justify-center gap-2 w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors"
                  >
                    Submit as JV Deal
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                  <button
                    onClick={reset}
                    className="w-full border border-border-default text-white/40 font-semibold py-4 rounded-xl hover:border-white/20 hover:text-white/60 transition-colors"
                  >
                    New Analysis
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
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
