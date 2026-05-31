'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MinimalHeader from '@/components/tools/MinimalHeader'
import {
  type AdjustmentPill,
  type SFRAnalysisPayload,
  type SFRAnalysisResult,
  analyzeSFR,
} from './analyze'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlaceSelection {
  formattedAddress: string
  lat: number
  lng: number
}

interface PropertyInfo {
  beds: number | ''
  baths: number | ''
  sqft: number | ''
  parking: 'garage' | 'carport' | 'both' | 'none'
  garageSpaces: number
  features: string[]
  condition: 'light' | 'full' | 'heavy'
}

interface RawComp {
  id: string
  address: string
  city: string
  state: string
  zip: string
  beds: number
  baths: number
  sqft: number
  yearBuilt: number
  salePrice: number
  saleDate: string
  daysAgo: number
  pricePerSqft: number | null
  distanceMiles: number
  latitude: number
  longitude: number
  garage: boolean
  garageSpaces: number
  pool: boolean
}

interface ProcessedComp extends RawComp {
  adjustedPrice: number
  adjustments: AdjustmentPill[]
}

interface CalcResults {
  pctAmount: number
  endBuyerMax: number
  mao: number
  anchorOffer: number
}

interface Filters {
  radius: 0.25 | 0.5 | 1
  days: 30 | 60 | 90 | 180 | 365
  sqftRange: 100 | 250 | 500
  yearRange: 5 | 10 | 20
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function computeAdjustments(comp: RawComp, info: PropertyInfo): { adjustments: AdjustmentPill[]; adjustedPrice: number } {
  const pills: AdjustmentPill[] = []
  let delta = 0

  const subBeds = typeof info.beds === 'number' ? info.beds : 0
  const subBaths = typeof info.baths === 'number' ? info.baths : 0

  if (comp.beds != null && subBeds !== 0 && comp.beds !== subBeds) {
    const amt = (subBeds - comp.beds) * 10000
    delta += amt
    pills.push({ label: `${amt > 0 ? '+' : ''}${subBeds - comp.beds} bed`, amount: amt })
  }

  if (comp.baths != null && subBaths !== 0 && comp.baths !== subBaths) {
    const amt = (subBaths - comp.baths) * 5000
    delta += amt
    pills.push({ label: `${amt > 0 ? '+' : ''}${(subBaths - comp.baths).toFixed(1)} bath`, amount: amt })
  }

  const subHasGarage = info.parking === 'garage' || info.parking === 'both'
  const subHasCarport = info.parking === 'carport' || info.parking === 'both'

  if (subHasGarage) {
    delta += 10000
    pills.push({ label: '+garage', amount: 10000 })
    if (info.garageSpaces > 0) {
      const spAmt = info.garageSpaces * 5000
      delta += spAmt
      pills.push({ label: `+${info.garageSpaces} bay${info.garageSpaces > 1 ? 's' : ''}`, amount: spAmt })
    }
  }

  if (subHasCarport) {
    delta += 5000
    pills.push({ label: '+carport', amount: 5000 })
  }

  if (info.features.includes('Pool')) {
    delta += 10000
    pills.push({ label: '+pool', amount: 10000 })
  }

  return { adjustments: pills, adjustedPrice: Math.max(0, comp.salePrice + delta) }
}

const SESSION_KEY = (addr: string) => `reiblast_comps_${addr}`

const REPAIR_RATES: Record<'light' | 'full' | 'heavy', number> = {
  light: 6,
  full: 17,
  heavy: 40,
}

const REPAIR_LABELS: Record<'light' | 'full' | 'heavy', string> = {
  light: 'Light cosmetic',
  full: 'Full cosmetic + systems',
  heavy: 'Heavy rehab',
}

// ─── Google Maps window types ─────────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google: any
    initSFRGoogleMaps?: () => void
  }
}

// ─── Step progress ────────────────────────────────────────────────────────────

function StepProgress({ step }: { step: number }) {
  const labels = ['Address', 'Property', 'Comps', 'Results']
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => {
        const n = i + 1
        const done = n < step
        const active = n === step
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? 'bg-gold text-black'
                    : active
                    ? 'bg-gold text-black'
                    : 'bg-surface-2 text-white/30 border border-border-default'
                }`}
              >
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  n
                )}
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-gold' : done ? 'text-white/50' : 'text-white/20'}`}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className={`flex-1 h-px mb-4 ${done ? 'bg-gold/40' : 'bg-border-default'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-surface-2 rounded-lg animate-pulse ${className ?? ''}`}
      style={{ animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
    />
  )
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="bg-surface border border-border-default rounded-xl p-5 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((k) => (
          <div key={k} className="bg-surface border border-border-default rounded-xl p-4 flex gap-4">
            <Skeleton className="w-16 h-12 shrink-0 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function SFRContent() {
  const searchParams = useSearchParams()
  const locationId = searchParams.get('token') ?? ''

  // Step state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1
  const [place, setPlace] = useState<PlaceSelection | null>(null)
  const [addressInput, setAddressInput] = useState('')

  // Step 2
  const [propInfo, setPropInfo] = useState<PropertyInfo>({
    beds: '',
    baths: '',
    sqft: '',
    parking: 'none',
    garageSpaces: 1,
    features: [],
    condition: 'light',
  })
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Step 3
  const [allComps, setAllComps] = useState<RawComp[]>([])
  const [fetchingComps, setFetchingComps] = useState(false)
  const [compsError, setCompsError] = useState('')
  const [filters, setFilters] = useState<Filters>({ radius: 0.5, days: 90, sqftRange: 250, yearRange: 10 })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false)

  // Step 4
  const [analysis, setAnalysis] = useState<SFRAnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [conditionUsedForAnalysis, setConditionUsedForAnalysis] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1)
  const [tab2Unlocked, setTab2Unlocked] = useState(false)
  const [tab3Unlocked, setTab3Unlocked] = useState(false)

  // Tab 2 inputs
  const [investorPct, setInvestorPct] = useState(70)
  const [repairLevel, setRepairLevel] = useState<'light' | 'full' | 'heavy'>('full')
  const [wholesaleFee, setWholesaleFee] = useState(10000)

  // Tab 3
  const [calcResults, setCalcResults] = useState<CalcResults | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ dealUrl: string; ghlWarning?: string } | null>(null)
  const [saveError, setSaveError] = useState('')

  // Refs
  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<unknown>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const gMapRef = useRef<unknown>(null)
  const markersRef = useRef<Map<string, unknown>>(new Map())
  const circleRef = useRef<unknown>(null)
  const subjectMarkerRef = useRef<unknown>(null)

  // ── Computed ────────────────────────────────────────────────────────────────

  const processedComps = useMemo<ProcessedComp[]>(() => {
    return allComps.map((c) => ({ ...c, ...computeAdjustments(c, propInfo) }))
  }, [allComps, propInfo])

  const filteredComps = useMemo<ProcessedComp[]>(() => {
    const sqft = typeof propInfo.sqft === 'number' ? propInfo.sqft : null
    return processedComps.filter((c) => {
      if (c.distanceMiles > filters.radius) return false
      if (c.daysAgo > filters.days) return false
      if (sqft && c.sqft && Math.abs(c.sqft - sqft) > filters.sqftRange) return false
      return true
    })
  }, [processedComps, filters, propInfo])

  const selectedCount = selectedIds.size
  const canAnalyze = selectedCount >= 1
  const hasLowComps = selectedCount >= 1 && selectedCount < 3

  const selectedCompsForPayload = useMemo(() => {
    return processedComps.filter((c) => selectedIds.has(c.id))
  }, [processedComps, selectedIds])

  // ── Google Maps loading ─────────────────────────────────────────────────────

  function initAutocomplete() {
    if (!addressInputRef.current || !window.google?.maps?.places) return
    autocompleteRef.current = new window.google.maps.places.Autocomplete(addressInputRef.current, {
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry'],
    })
    ;(autocompleteRef.current as { addListener: (e: string, cb: () => void) => void }).addListener(
      'place_changed',
      () => {
        const ac = autocompleteRef.current as {
          getPlace: () => { formatted_address?: string; geometry?: { location: { lat: () => number; lng: () => number } } }
        }
        const p = ac.getPlace()
        if (!p.formatted_address || !p.geometry) return
        const newPlace: PlaceSelection = {
          formattedAddress: p.formatted_address,
          lat: p.geometry.location.lat(),
          lng: p.geometry.location.lng(),
        }
        setPlace(newPlace)
        setAddressInput(p.formatted_address)
        setStep(2)
      }
    )
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
    if (!key) return

    window.initSFRGoogleMaps = () => {
      setGoogleMapsLoaded(true)
      initAutocomplete()
    }

    if (window.google?.maps) {
      setGoogleMapsLoaded(true)
      initAutocomplete()
      return
    }

    if (!document.getElementById('gmaps-sfr')) {
      const script = document.createElement('script')
      script.id = 'gmaps-sfr'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&callback=initSFRGoogleMaps`
      script.async = true
      document.head.appendChild(script)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-init autocomplete when step returns to 1 and google is already loaded
  useEffect(() => {
    if (step === 1 && googleMapsLoaded && addressInputRef.current && !autocompleteRef.current) {
      initAutocomplete()
    }
  }, [step, googleMapsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map initialization ──────────────────────────────────────────────────────

  const updateCompMarkers = useCallback(() => {
    if (!gMapRef.current || !window.google?.maps) return
    const g = window.google.maps
    const currentIds = new Set(processedComps.map((c) => c.id))

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        (marker as { setMap: (m: null) => void }).setMap(null)
        markersRef.current.delete(id)
      }
    })

    processedComps.forEach((comp) => {
      if (!comp.latitude || !comp.longitude) return
      const isSelected = selectedIds.has(comp.id)
      const icon = {
        path: g.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: isSelected ? '#F5C842' : '#555555',
        fillOpacity: 1,
        strokeColor: isSelected ? '#000000' : '#333333',
        strokeWeight: 1,
      }

      if (markersRef.current.has(comp.id)) {
        const m = markersRef.current.get(comp.id) as { setIcon: (i: unknown) => void }
        m.setIcon(icon)
      } else {
        const marker = new g.Marker({
          position: { lat: comp.latitude, lng: comp.longitude },
          map: gMapRef.current,
          icon,
          title: comp.address,
        })
        marker.addListener('click', () => {
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(comp.id)) {
              next.delete(comp.id)
            } else {
              next.add(comp.id)
            }
            return next
          })
        })
        markersRef.current.set(comp.id, marker)
      }
    })
  }, [processedComps, selectedIds])

  useEffect(() => {
    if (step !== 3 || !googleMapsLoaded || !place || !mapContainerRef.current || gMapRef.current) return

    const g = window.google.maps
    const map = new g.Map(mapContainerRef.current, {
      center: { lat: place.lat, lng: place.lng },
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: g.ControlPosition?.RIGHT_CENTER },
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
        { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    })
    gMapRef.current = map

    subjectMarkerRef.current = new g.Marker({
      position: { lat: place.lat, lng: place.lng },
      map,
      zIndex: 10,
      icon: {
        path: g.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: '#F5C842',
        fillOpacity: 1,
        strokeColor: '#000000',
        strokeWeight: 2,
      },
      title: 'Subject Property',
    })

    circleRef.current = new g.Circle({
      strokeColor: '#F5C842',
      strokeOpacity: 0.4,
      strokeWeight: 1,
      fillColor: '#F5C842',
      fillOpacity: 0.06,
      map,
      center: { lat: place.lat, lng: place.lng },
      radius: filters.radius * 1609.34,
    })

    updateCompMarkers()
  }, [step, googleMapsLoaded, place]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!circleRef.current) return
    ;(circleRef.current as { setRadius: (r: number) => void }).setRadius(filters.radius * 1609.34)
  }, [filters.radius])

  useEffect(() => {
    if (step === 3) updateCompMarkers()
  }, [step, processedComps, selectedIds, updateCompMarkers])

  // ── Comp fetching ───────────────────────────────────────────────────────────

  async function fetchComps() {
    if (!place) return
    setFetchingComps(true)
    setCompsError('')
    try {
      const res = await fetch('/api/analyzer/comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: place.lat,
          lng: place.lng,
          beds: typeof propInfo.beds === 'number' ? propInfo.beds : 0,
          sqft: typeof propInfo.sqft === 'number' ? propInfo.sqft : 0,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setCompsError(d.error || 'Failed to fetch comps')
        return
      }
      const data: RawComp[] = await res.json()
      setAllComps(data)
      sessionStorage.setItem(SESSION_KEY(place.formattedAddress), JSON.stringify(data))
      // Auto-select comps passing default filters
      const defaultPassing = data.filter(
        (c) => c.distanceMiles <= 0.5 && c.daysAgo <= 90
      )
      setSelectedIds(new Set(defaultPassing.map((c) => c.id)))
    } catch {
      setCompsError('Network error fetching comps. Try again.')
    } finally {
      setFetchingComps(false)
    }
  }

  useEffect(() => {
    if (step !== 3 || !place) return
    const cached = sessionStorage.getItem(SESSION_KEY(place.formattedAddress))
    if (cached) {
      try {
        const data: RawComp[] = JSON.parse(cached)
        setAllComps(data)
        if (selectedIds.size === 0) {
          const defaultPassing = data.filter(
            (c) => c.distanceMiles <= 0.5 && c.daysAgo <= 90
          )
          setSelectedIds(new Set(defaultPassing.map((c) => c.id)))
        }
        return
      } catch {
        // corrupted cache — fall through to fetch
      }
    }
    fetchComps()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analysis ────────────────────────────────────────────────────────────────

  async function runAnalysis() {
    if (!place || selectedCompsForPayload.length < 1) return
    setAnalyzing(true)
    setAnalysisError('')
    setTab2Unlocked(false)
    setTab3Unlocked(false)
    setCalcResults(null)
    setActiveTab(1)

    try {
      const result = await analyzeSFR({
        subject: {
          address: place.formattedAddress,
          beds: propInfo.beds,
          baths: propInfo.baths,
          sqft: propInfo.sqft,
          parking: propInfo.parking,
          garageSpaces: propInfo.garageSpaces,
          features: propInfo.features,
          condition: propInfo.condition,
        },
        comps: selectedCompsForPayload.map((c) => ({
          address: c.address,
          salePrice: c.salePrice,
          adjustedPrice: c.adjustedPrice,
          adjustments: c.adjustments,
          beds: c.beds,
          baths: c.baths,
          sqft: c.sqft,
          distanceMiles: c.distanceMiles,
          daysSinceSold: c.daysAgo,
          pricePerSqft: c.pricePerSqft,
        })),
      })
      setAnalysis(result)
      setConditionUsedForAnalysis(propInfo.condition)
      setStep(4)
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed. Try again.')
      setStep(4)
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Tab 2 calculator ────────────────────────────────────────────────────────

  function calculateOffer() {
    if (!analysis) return
    const arv = analysis.arv.estimate
    const sqft = typeof propInfo.sqft === 'number' ? propInfo.sqft : 0
    const repairs = sqft * REPAIR_RATES[repairLevel]
    const pctAmount = arv * (investorPct / 100)
    const endBuyerMax = pctAmount - repairs
    const mao = endBuyerMax - wholesaleFee
    const anchorOffer = mao * 0.8
    setCalcResults({ pctAmount, endBuyerMax, mao, anchorOffer })
    setTab3Unlocked(true)
    setActiveTab(3)
  }

  // ── Save flow ───────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!place || !analysis || !calcResults) return
    setSaving(true)
    setSaveError('')
    setSaveResult(null)
    const sqft = typeof propInfo.sqft === 'number' ? propInfo.sqft : 0
    const repairs = sqft * REPAIR_RATES[repairLevel]
    try {
      const res = await fetch('/api/analyzer/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: locationId || 'unknown',
          address: place.formattedAddress,
          arv: analysis.arv.estimate,
          endBuyerMax: calcResults.endBuyerMax,
          repairLevel,
          repairs,
          wholesaleFee,
          mao: calcResults.mao,
          anchorOffer: calcResults.anchorOffer,
          investorPct,
          narrative: analysis.narrative,
          compsUsed: selectedCompsForPayload.length,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error || 'Save failed')
        return
      }
      setSaveResult(data)
    } catch {
      setSaveError('Network error. Try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Step 2 validation ───────────────────────────────────────────────────────

  function validateStep2(): boolean {
    const errs: Record<string, string> = {}
    if (propInfo.beds === '') errs.beds = 'Bedrooms is required'
    if (propInfo.baths === '') errs.baths = 'Bathrooms is required'
    if (propInfo.sqft === '') errs.sqft = 'Square footage is required'
    setValidationErrors(errs)
    return Object.keys(errs).length === 0
  }

  function toggleFeature(f: string) {
    setPropInfo((p) => ({
      ...p,
      features: p.features.includes(f) ? p.features.filter((x) => x !== f) : [...p.features, f],
    }))
  }

  function toggleComp(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetAll() {
    setStep(1)
    setPlace(null)
    setAddressInput('')
    setPropInfo({ beds: '', baths: '', sqft: '', parking: 'none', garageSpaces: 1, features: [], condition: 'light' })
    setAllComps([])
    setSelectedIds(new Set())
    setFilters({ radius: 0.5, days: 90, sqftRange: 250, yearRange: 10 })
    setAnalysis(null)
    setAnalysisError('')
    setActiveTab(1)
    setTab2Unlocked(false)
    setTab3Unlocked(false)
    setCalcResults(null)
    setSaveResult(null)
    setSaveError('')
    setConditionUsedForAnalysis(null)
    gMapRef.current = null
    markersRef.current.clear()
    circleRef.current = null
    subjectMarkerRef.current = null
    autocompleteRef.current = null
  }

  const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ?? ''

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white">
      <MinimalHeader title="SFR Analyzer" />

      <div className="max-w-5xl mx-auto px-4 py-6">
        <StepProgress step={step} />

        {/* ── STEP 1: Address ── */}
        {step === 1 && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-xl font-bold mb-2 text-center">Enter the property address</h2>
            <p className="text-white/40 text-sm mb-8 text-center">We&apos;ll pull comps and let you confirm property details.</p>
            <div className="relative mb-3">
              <input
                ref={addressInputRef}
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="123 Main St, Dallas TX"
                className="w-full bg-surface-2 text-white rounded-xl border border-border-default focus:border-gold px-5 py-4 text-base outline-none transition-colors placeholder:text-white/30"
              />
            </div>
            <p className="text-white/30 text-xs text-center">Select from the dropdown — we need the coordinates.</p>
          </div>
        )}

        {/* ── STEP 2: Property Confirmation ── */}
        {step === 2 && place && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-bold mb-1">Confirm property details</h2>
            <p className="text-white/40 text-sm mb-6">
              We couldn&apos;t pull details automatically in this flow — enter them below.
            </p>

            {/* Street View + Satellite */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-xl overflow-hidden border border-border-default">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${place.lat},${place.lng}&key=${MAPS_KEY}`}
                  alt="Street view"
                  className="w-full h-40 object-cover"
                />
                <p className="text-white/30 text-[10px] text-center py-1.5">Street View</p>
              </div>
              <div className="rounded-xl overflow-hidden border border-border-default">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://maps.googleapis.com/maps/api/staticmap?center=${place.lat},${place.lng}&zoom=19&size=600x300&maptype=satellite&key=${MAPS_KEY}`}
                  alt="Satellite view"
                  className="w-full h-40 object-cover"
                />
                <p className="text-white/30 text-[10px] text-center py-1.5">Satellite</p>
              </div>
            </div>

            {/* Read-only address/coords */}
            <div className="bg-surface border border-border-default rounded-xl p-4 mb-6">
              <div className="mb-3">
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Address</p>
                <p className="text-white font-medium text-sm">{place.formattedAddress}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Coordinates</p>
                <p className="text-white/60 text-sm font-mono">
                  {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                </p>
              </div>
            </div>

            {/* Beds / Baths / Sqft */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {(
                [
                  { key: 'beds', label: 'Bedrooms', placeholder: '3' },
                  { key: 'baths', label: 'Bathrooms', placeholder: '2' },
                  { key: 'sqft', label: 'Square Footage', placeholder: '1500' },
                ] as { key: 'beds' | 'baths' | 'sqft'; label: string; placeholder: string }[]
              ).map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">{label}</label>
                  <input
                    type="number"
                    value={propInfo[key] === '' ? '' : propInfo[key]}
                    onChange={(e) => {
                      const v = e.target.value
                      setPropInfo((p) => ({ ...p, [key]: v === '' ? '' : Number(v) }))
                      setValidationErrors((prev) => ({ ...prev, [key]: '' }))
                    }}
                    placeholder={placeholder}
                    min="0"
                    className={`w-full bg-surface-2 text-white rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/20 ${
                      validationErrors[key] ? 'border-red-500' : 'border-border-default focus:border-gold'
                    }`}
                  />
                  {validationErrors[key] && (
                    <p className="text-red-400 text-xs mt-1">{validationErrors[key]}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Parking */}
            <div className="mb-6">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Parking</p>
              <div className="grid grid-cols-4 gap-2">
                {(['garage', 'carport', 'both', 'none'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPropInfo((prev) => ({ ...prev, parking: p }))}
                    className={`py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ${
                      propInfo.parking === p
                        ? 'bg-gold text-black border-gold'
                        : 'bg-surface-2 text-white/50 border-border-default hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {(propInfo.parking === 'garage' || propInfo.parking === 'both') && (
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-white/40 text-xs uppercase tracking-wider">Garage spaces</label>
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={propInfo.garageSpaces}
                    onChange={(e) => setPropInfo((p) => ({ ...p, garageSpaces: Math.min(4, Math.max(1, Number(e.target.value))) }))}
                    className="w-16 bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-2 py-1.5 text-sm text-center outline-none"
                  />
                </div>
              )}
            </div>

            {/* Additional features */}
            <div className="mb-6">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Additional features</p>
              <div className="flex flex-wrap gap-2">
                {['Pool', 'Solar', 'Fenced yard', 'Shed / outbuilding'].map((f) => {
                  const on = propInfo.features.includes(f)
                  return (
                    <button
                      key={f}
                      onClick={() => toggleFeature(f)}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        on
                          ? 'bg-gold/20 border-gold text-gold'
                          : 'bg-surface-2 border-border-default text-white/50 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Condition */}
            <div className="mb-8">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Condition</p>
              <div className="space-y-2">
                {(
                  [
                    { value: 'light', title: 'Light cosmetic', desc: 'Paint, flooring, fixtures — property is livable' },
                    { value: 'full', title: 'Full cosmetic + systems', desc: 'Kitchen, baths, HVAC, plumbing — real work needed' },
                    { value: 'heavy', title: 'Heavy rehab', desc: 'Full gut, roof, electrical, structural — significant investment' },
                  ] as const
                ).map(({ value, title, desc }) => (
                  <button
                    key={value}
                    onClick={() => setPropInfo((p) => ({ ...p, condition: value }))}
                    className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
                      propInfo.condition === value
                        ? 'border-gold bg-gold/10'
                        : 'border-border-default bg-surface-2 hover:border-white/20'
                    }`}
                  >
                    <p className={`font-semibold text-sm ${propInfo.condition === value ? 'text-gold' : 'text-white'}`}>{title}</p>
                    <p className="text-white/40 text-xs mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                if (validateStep2()) setStep(3)
              }}
              className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors mb-3"
            >
              Pull Comps →
            </button>
            <button
              onClick={() => setStep(1)}
              className="w-full text-white/40 text-sm py-2 hover:text-white transition-colors"
            >
              ← Change address
            </button>
          </div>
        )}

        {/* ── STEP 3: Comp Selection ── */}
        {step === 3 && (
          <div className="flex flex-col gap-4">

            {/* Map — top */}
            <div className="relative rounded-xl overflow-hidden border border-border-default" style={{ height: 300 }}>
              <div ref={mapContainerRef} className="w-full h-full" />
              {!googleMapsLoaded && <Skeleton className="absolute inset-0" />}
            </div>

            {/* Filters */}
            <div className="bg-surface border border-border-default rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-white/30 text-xs w-20 shrink-0">Radius</span>
                <div className="flex gap-1">
                  {([0.25, 0.5, 1] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setFilters((f) => ({ ...f, radius: r }))}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        filters.radius === r ? 'bg-gold text-black' : 'text-white/40 hover:text-white'
                      }`}
                    >
                      {r}mi
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/30 text-xs w-20 shrink-0">Sold within</span>
                <div className="flex gap-1">
                  {([30, 60, 90, 180, 365] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setFilters((f) => ({ ...f, days: d }))}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        filters.days === d ? 'bg-gold text-black' : 'text-white/40 hover:text-white'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/30 text-xs w-20 shrink-0">Sqft ±</span>
                <div className="flex gap-1">
                  {([100, 250, 500] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilters((f) => ({ ...f, sqftRange: s }))}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        filters.sqftRange === s ? 'bg-gold text-black' : 'text-white/40 hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/30 text-xs w-20 shrink-0">Year built ±</span>
                <div className="flex gap-1">
                  {([5, 10, 20] as const).map((y) => (
                    <button
                      key={y}
                      onClick={() => setFilters((f) => ({ ...f, yearRange: y }))}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        filters.yearRange === y ? 'bg-gold text-black' : 'text-white/40 hover:text-white'
                      }`}
                    >
                      {y}yr
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Comp count */}
            <div className="flex items-center justify-between">
              <p className="text-white/40 text-sm">
                {filteredComps.length} comp{filteredComps.length !== 1 ? 's' : ''} visible
              </p>
              <p className={`text-sm font-semibold ${selectedCount > 0 ? 'text-gold' : 'text-white/30'}`}>
                {selectedCount} selected
              </p>
            </div>

            {/* Low-comp warning banner */}
            {hasLowComps && (
              <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 flex items-start gap-2">
                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-yellow-400/90 text-xs leading-relaxed">
                  Only {selectedCount} comp{selectedCount === 1 ? '' : 's'} found in this area. The AI analysis will note limited data — treat results as directional only.
                </p>
              </div>
            )}

            {/* Comp list */}
            {fetchingComps ? (
              <div className="space-y-3 pb-24">
                {[1, 2, 3, 4].map((k) => (
                  <div key={k} className="bg-surface border border-border-default rounded-xl p-4 flex gap-3">
                    <Skeleton className="w-20 h-14 shrink-0 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : compsError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-3">{compsError}</p>
                <button onClick={() => fetchComps()} className="text-gold hover:underline text-sm">
                  Try again
                </button>
              </div>
            ) : filteredComps.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-10">
                No comparable sales found in this area. Try expanding your filters.
              </p>
            ) : (
              <div className="space-y-2 pb-24">
                {filteredComps.map((comp) => {
                  const selected = selectedIds.has(comp.id)
                  const totalAdj = comp.adjustments.reduce((s, a) => s + a.amount, 0)
                  return (
                    <div
                      key={comp.id}
                      onClick={() => toggleComp(comp.id)}
                      className={`bg-surface rounded-xl p-3 cursor-pointer transition-all flex gap-3 border ${
                        selected ? 'border-gold' : 'border-border-default hover:border-white/20'
                      }`}
                    >
                      {/* Street view thumb */}
                      {comp.latitude && comp.longitude && MAPS_KEY ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://maps.googleapis.com/maps/api/streetview?size=160x120&location=${comp.latitude},${comp.longitude}&key=${MAPS_KEY}`}
                          alt=""
                          className="w-20 h-14 object-cover rounded-lg shrink-0"
                        />
                      ) : (
                        <div className="w-20 h-14 bg-surface-2 rounded-lg shrink-0" />
                      )}

                      {/* Comp info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-white text-xs font-semibold leading-tight truncate">{comp.address}</p>
                          <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${selected ? 'bg-gold border-gold' : 'border-white/20'}`}>
                            {selected && (
                              <svg className="w-2.5 h-2.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>

                        <div className="flex items-baseline gap-1.5 mb-1">
                          <span className="text-white/50 text-xs line-through">{fmt(comp.salePrice)}</span>
                          <span className="text-gold text-sm font-bold">{fmt(comp.adjustedPrice)}</span>
                        </div>

                        <p className="text-white/30 text-[11px] mb-1.5">
                          {comp.beds}bd · {comp.baths}ba · {comp.sqft?.toLocaleString()} sqft
                          {comp.pricePerSqft ? ` · $${comp.pricePerSqft}/sf` : ''}
                          {' · '}{comp.distanceMiles?.toFixed(2)}mi{' · '}{comp.daysAgo}d ago
                        </p>

                        {/* Adjustment pills */}
                        {comp.adjustments.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {comp.adjustments.map((a, i) => (
                              <span
                                key={i}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  a.amount > 0 ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                                }`}
                              >
                                {a.label} ({a.amount > 0 ? '+' : ''}{fmt(a.amount)})
                              </span>
                            ))}
                            {totalAdj !== 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-white/5 text-white/50">
                                net {totalAdj > 0 ? '+' : ''}{fmt(totalAdj)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Drawing tool stub */}
            <button
              disabled
              className="text-white/20 text-xs border border-border-default rounded-lg px-3 py-2 cursor-not-allowed w-full"
            >
              Draw custom area (coming soon)
            </button>
          </div>
        )}

        {/* Sticky analyze bar for step 3 */}
        {step === 3 && (
          <div className="fixed bottom-0 left-0 right-0 bg-black border-t border-border-default px-4 py-4 flex items-center justify-between gap-4 z-20">
            <div>
              <p className={`text-sm font-semibold ${canAnalyze ? 'text-white' : 'text-white/30'}`}>
                {selectedCount} comp{selectedCount !== 1 ? 's' : ''} selected
              </p>
              {selectedCount === 0 && <p className="text-white/30 text-xs">Select comps to run analysis</p>}
            </div>
            <button
              onClick={runAnalysis}
              disabled={!canAnalyze}
              className="bg-gold text-black font-bold px-6 py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Run analysis →
            </button>
          </div>
        )}

        {/* ── STEP 4: Results ── */}
        {step === 4 && (
          <div className="max-w-3xl mx-auto">
            {/* Condition change banner */}
            {analysis && conditionUsedForAnalysis && propInfo.condition !== conditionUsedForAnalysis && (
              <div className="mb-6 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <p className="text-yellow-400 font-semibold text-sm">Your repair condition has changed.</p>
                  <p className="text-yellow-400/70 text-xs mt-0.5">Re-run the analysis to get accurate results.</p>
                </div>
                <button
                  onClick={runAnalysis}
                  className="text-yellow-400 border border-yellow-400/40 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-yellow-400/10 transition-colors shrink-0"
                >
                  Re-run analysis
                </button>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-surface rounded-xl p-1 mb-6">
              {(
                [
                  { n: 1 as const, label: 'AI Analysis' },
                  { n: 2 as const, label: 'Deal Calculator', locked: !tab2Unlocked },
                  { n: 3 as const, label: 'Offer Results', locked: !tab3Unlocked },
                ]
              ).map(({ n, label, locked }) => (
                <button
                  key={n}
                  onClick={() => !locked && setActiveTab(n)}
                  disabled={!!locked}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === n
                      ? 'bg-gold text-black'
                      : locked
                      ? 'text-white/20 cursor-not-allowed'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  {locked && (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                  {label}
                </button>
              ))}
            </div>

            {/* ── TAB 1: AI Analysis ── */}
            {activeTab === 1 && (
              <div>
                {analyzing ? (
                  <AnalysisSkeleton />
                ) : analysisError ? (
                  <div className="text-center py-16">
                    <p className="text-red-400 mb-4 text-sm">{analysisError}</p>
                    <button onClick={() => setStep(3)} className="text-gold hover:underline text-sm">
                      ← Back to comps
                    </button>
                  </div>
                ) : analysis ? (
                  <div className="space-y-5">
                    {/* ARV + As-Is cards */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* ARV */}
                      <div className="bg-surface border border-gold rounded-xl p-5">
                        <p className="text-gold text-[10px] uppercase tracking-wider mb-1">After Repair Value</p>
                        <p className="text-white/40 text-xs mb-1">{fmt(analysis.arv.low)} — {fmt(analysis.arv.high)}</p>
                        <p className="text-white text-2xl font-bold mb-2">{fmt(analysis.arv.estimate)}</p>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          analysis.arv.confidence === 'high'
                            ? 'bg-green-400/15 text-green-400'
                            : analysis.arv.confidence === 'medium'
                            ? 'bg-yellow-400/15 text-yellow-400'
                            : 'bg-red-400/15 text-red-400'
                        }`}>
                          {analysis.arv.confidence} confidence
                        </span>
                        <p className="text-white/30 text-[11px] mt-2 italic leading-relaxed">{analysis.arv.confidence_reason}</p>
                      </div>

                      {/* As-Is Value */}
                      <div className="bg-surface border border-border-default rounded-xl p-5">
                        <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">As-Is Value</p>
                        {analysis.as_is.value != null ? (
                          <>
                            <p className="text-white/40 text-xs mb-1">
                              {analysis.as_is.low != null ? fmt(analysis.as_is.low) : '—'} — {analysis.as_is.high != null ? fmt(analysis.as_is.high) : '—'}
                            </p>
                            <p className="text-white text-2xl font-bold mb-2">{fmt(analysis.as_is.value)}</p>
                          </>
                        ) : (
                          <p className="text-white/30 text-sm mt-2 mb-4">Not enough AS_IS comps</p>
                        )}
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          analysis.exit_strategy.recommendation === 'WHOLESALE'
                            ? 'bg-gold/15 text-gold'
                            : analysis.exit_strategy.recommendation === 'FIX_AND_FLIP'
                            ? 'bg-blue-400/15 text-blue-400'
                            : analysis.exit_strategy.recommendation === 'SUBJECT_TO'
                            ? 'bg-purple-400/15 text-purple-400'
                            : 'bg-red-400/15 text-red-400'
                        }`}>
                          {analysis.exit_strategy.recommendation.replace('_', ' ')}
                        </span>
                        <p className="text-white/30 text-[11px] mt-2 italic leading-relaxed">{analysis.as_is.note}</p>
                      </div>
                    </div>

                    {/* Subject property chips */}
                    <div className="flex gap-2">
                      {[
                        { label: 'Beds', value: propInfo.beds },
                        { label: 'Baths', value: propInfo.baths },
                        { label: 'Sqft', value: typeof propInfo.sqft === 'number' ? propInfo.sqft.toLocaleString() : propInfo.sqft },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-surface-2 rounded-lg px-3 py-2">
                          <p className="text-white/30 text-[10px]">{label}</p>
                          <p className="text-white font-semibold text-sm">{value || '—'}</p>
                        </div>
                      ))}
                    </div>

                    {/* Comp breakdown */}
                    <div>
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Comp Breakdown</p>
                      <div className="space-y-2">
                        {analysis.comps.map((comp, i) => {
                          const original = selectedCompsForPayload.find((c) => c.address === comp.address)
                          return (
                            <div key={i} className="bg-surface border border-border-default rounded-xl p-4 flex gap-3">
                              {/* Street view thumb */}
                              {original?.latitude && original?.longitude && MAPS_KEY ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`https://maps.googleapis.com/maps/api/streetview?size=160x120&location=${original.latitude},${original.longitude}&key=${MAPS_KEY}`}
                                  alt=""
                                  className="w-16 h-12 object-cover rounded-lg shrink-0"
                                />
                              ) : (
                                <div className="w-16 h-12 bg-surface-2 rounded-lg shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <p className="text-white text-xs font-semibold truncate">{comp.address}</p>
                                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                    comp.type === 'RENOVATED'
                                      ? 'bg-blue-400/15 text-blue-400'
                                      : 'bg-orange-400/15 text-orange-400'
                                  }`}>
                                    {comp.type}
                                  </span>
                                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    comp.weight === 'high'
                                      ? 'bg-green-400/10 text-green-400'
                                      : comp.weight === 'medium'
                                      ? 'bg-yellow-400/10 text-yellow-400'
                                      : 'bg-white/5 text-white/40'
                                  }`}>
                                    {comp.weight} weight
                                  </span>
                                </div>
                                <div className="flex items-baseline gap-2 mb-1.5">
                                  <span className="text-white/40 text-xs line-through">{fmt(comp.sale_price)}</span>
                                  <span className="text-white text-sm font-bold">→ {fmt(comp.adjusted_price)}</span>
                                </div>
                                {original && original.adjustments.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {original.adjustments.map((a, j) => (
                                      <span
                                        key={j}
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                          a.amount > 0 ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                                        }`}
                                      >
                                        {a.label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Narrative */}
                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">AI Narrative</p>
                      <p className="text-white text-sm leading-relaxed">{analysis.narrative}</p>
                    </div>

                    {/* Warnings */}
                    {analysis.warnings.length > 0 && (
                      <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-xl p-4">
                        <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-2">Flags</p>
                        <ul className="space-y-1">
                          {analysis.warnings.map((w, i) => (
                            <li key={i} className="text-yellow-400/70 text-xs flex gap-2">
                              <span className="mt-0.5 shrink-0">⚠</span>
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Exit strategy */}
                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-2">Exit Strategy</p>
                      <p className="text-white/70 text-sm leading-relaxed">{analysis.exit_strategy.reasoning}</p>
                    </div>

                    {/* Disclosures */}
                    <div className="space-y-2 pt-2 border-t border-border-default">
                      <p className="text-white/25 text-[11px] leading-relaxed">
                        ⓘ AriAI can make mistakes. Always verify ARV estimates and comp data with your own due diligence before making an offer.
                      </p>
                      <p className="text-white/25 text-[11px] leading-relaxed">
                        ⓘ Changing your repair tier in the calculator does not update this analysis. Re-run the analysis with your selected condition for the most accurate results.
                      </p>
                    </div>

                    {/* CTA to Tab 2 */}
                    <button
                      onClick={() => {
                        setTab2Unlocked(true)
                        setActiveTab(2)
                      }}
                      className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors"
                    >
                      Run the numbers →
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── TAB 2: Deal Calculator ── */}
            {activeTab === 2 && (
              <div className="space-y-6">
                {/* Investor % */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-white/40 text-xs uppercase tracking-wider">Investor percentage</label>
                    <span className="text-gold font-bold text-lg">{investorPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={80}
                    step={1}
                    value={investorPct}
                    onChange={(e) => setInvestorPct(Number(e.target.value))}
                    className="w-full accent-gold"
                  />
                  <div className="flex justify-between text-white/20 text-xs mt-1">
                    <span>60%</span>
                    <span>80%</span>
                  </div>
                </div>

                {/* ARV read-only */}
                {analysis && (
                  <div className="bg-surface-2 border border-border-default rounded-xl p-4">
                    <p className="text-white/40 text-xs uppercase tracking-wider mb-1">ARV (from analysis)</p>
                    <p className="text-white text-2xl font-bold">{fmt(analysis.arv.estimate)}</p>
                  </div>
                )}

                {/* Repair level */}
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Repair level</p>
                  <div className="space-y-2">
                    {(
                      [
                        { value: 'light', rate: 6 },
                        { value: 'full', rate: 17 },
                        { value: 'heavy', rate: 40 },
                      ] as { value: 'light' | 'full' | 'heavy'; rate: number }[]
                    ).map(({ value, rate }) => {
                      const est = typeof propInfo.sqft === 'number' ? Math.round(propInfo.sqft * rate) : null
                      return (
                        <button
                          key={value}
                          onClick={() => setRepairLevel(value)}
                          className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
                            repairLevel === value
                              ? 'border-gold bg-gold/10'
                              : 'border-border-default bg-surface-2 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className={`font-semibold text-sm ${repairLevel === value ? 'text-gold' : 'text-white'}`}>
                              {REPAIR_LABELS[value]}
                            </p>
                            {est != null && (
                              <p className="text-white/40 text-xs">~{fmt(est)}</p>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Wholesale fee */}
                <div>
                  <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">Desired wholesale fee</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                    <input
                      type="number"
                      value={wholesaleFee}
                      onChange={(e) => setWholesaleFee(Number(e.target.value))}
                      min={0}
                      className="w-full bg-surface-2 text-white rounded-xl border border-border-default focus:border-gold pl-7 pr-4 py-3 text-base outline-none transition-colors"
                    />
                  </div>
                </div>

                <button
                  onClick={calculateOffer}
                  className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors"
                >
                  Calculate offer →
                </button>
              </div>
            )}

            {/* ── TAB 3: Offer Results ── */}
            {activeTab === 3 && calcResults && analysis && (
              <div className="space-y-6">
                {/* Breakdown table */}
                <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
                  <div className="divide-y divide-border-default">
                    {[
                      { label: 'ARV', value: analysis.arv.estimate, indent: false, gold: false },
                      { label: `× Investor % (${investorPct}%)`, value: calcResults.pctAmount, indent: true, gold: false },
                      { label: `− Repairs (${REPAIR_LABELS[repairLevel].toLowerCase()})`, value: -(typeof propInfo.sqft === 'number' ? propInfo.sqft * REPAIR_RATES[repairLevel] : 0), indent: true, gold: false },
                    ].map(({ label, value, indent, gold }) => (
                      <div key={label} className={`flex items-center justify-between px-5 py-3.5 ${indent ? 'pl-8' : ''}`}>
                        <span className="text-white/50 text-sm">{label}</span>
                        <span className={`font-semibold text-sm ${gold ? 'text-gold' : value < 0 ? 'text-red-400' : 'text-white'}`}>
                          {value < 0 ? `−${fmt(Math.abs(value))}` : fmt(value)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-5 py-3 bg-surface-2">
                      <span className="text-white font-semibold text-sm">End buyer max</span>
                      <span className="text-white font-bold">{fmt(calcResults.endBuyerMax)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5 pl-8">
                      <span className="text-white/50 text-sm">− Wholesale fee</span>
                      <span className="text-red-400 font-semibold text-sm">−{fmt(wholesaleFee)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-4 bg-gold/10">
                      <span className="text-gold font-bold text-base">MAO</span>
                      <span className="text-gold font-bold text-xl">{fmt(calcResults.mao)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div>
                        <p className="text-white font-semibold text-sm">Anchor offer</p>
                        <p className="text-white/30 text-xs mt-0.5">Start here — gives you room to negotiate up to MAO</p>
                      </div>
                      <span className="text-white font-bold text-lg">{fmt(calcResults.anchorOffer)}</span>
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                <div className="bg-surface-2 border border-border-default rounded-xl p-4 space-y-2">
                  <p className="text-white/50 text-xs leading-relaxed">
                    ⚠ Your MAO changes with your wholesale fee. Never submit an offer above end buyer max.
                  </p>
                </div>

                {/* Save result */}
                {saveResult && (
                  <div className="bg-green-400/10 border border-green-400/30 rounded-xl p-4">
                    <p className="text-green-400 font-semibold text-sm">Deal saved to REIblast!</p>
                    <p className="text-green-400/60 text-xs mt-0.5 break-all">{saveResult.dealUrl}</p>
                    {saveResult.ghlWarning && (
                      <p className="text-yellow-400/70 text-xs mt-2">{saveResult.ghlWarning}</p>
                    )}
                  </div>
                )}
                {saveError && (
                  <p className="text-red-400 text-sm">{saveError}</p>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setCalcResults(null)
                      setActiveTab(2)
                    }}
                    className="border border-border-default text-white/50 font-semibold py-3 rounded-xl hover:border-white/20 hover:text-white transition-colors"
                  >
                    Start over
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !!saveResult}
                    className="bg-gold text-black font-bold py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving…' : saveResult ? 'Saved ✓' : 'Add to REIblast'}
                  </button>
                </div>

                <button
                  onClick={resetAll}
                  className="w-full text-white/30 text-sm py-2 hover:text-white transition-colors"
                >
                  ← New analysis
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SFRPage() {
  return (
    <Suspense>
      <SFRContent />
    </Suspense>
  )
}
