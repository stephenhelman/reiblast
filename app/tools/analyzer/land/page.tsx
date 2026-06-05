'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MinimalHeader from '@/components/tools/MinimalHeader'
import {
  type LandAnalysisPayload,
  type LandAnalysisResult,
  type LandComp,
  analyzeLand,
} from './analyze'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlaceSelection {
  formattedAddress: string
  lat: number
  lng: number
}

interface CrmContact {
  id: string
  name: string
  phone: string | null
  address: string | null
}

interface LandInfo {
  lotSizeAcres: number | ''
  lotSizeSqft: number
  zoning: string
  roadAccess: 'yes' | 'no' | 'unknown' | ''
  utilities: string[]
  topography: 'flat' | 'sloped' | 'mixed' | 'unknown' | ''
  notes: string
}

interface LandFilters {
  radius: 1 | 2 | 5 | 10
  days: 180 | 365 | 730 | 1095 | null
  lotSizeRange: 0.25 | 0.5 | 1 | null
  lotType: 'all' | 'infill' | 'acreage' | 'large'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function capitalizeName(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase())
}

function relativeDate(daysAgo: number | null): string {
  if (daysAgo == null) return 'Unknown'
  if (daysAgo <= 90) return `${daysAgo}d ago`
  if (daysAgo <= 365) return `${Math.round(daysAgo / 30)}mo ago`
  return `${Math.round(daysAgo / 365)}yr ago`
}

function autoDetectLotType(acres: number): LandFilters['lotType'] {
  if (acres < 1) return 'infill'
  if (acres <= 10) return 'acreage'
  return 'large'
}

function SortIndicator({ col, sortCol, sortDir }: { col: string; sortCol: string | null; sortDir: 'asc' | 'desc' | null }) {
  if (sortCol !== col) {
    return (
      <svg className="w-3 h-3 text-white/20 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M8 9l4-4 4 4M8 15l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (sortDir === 'asc') {
    return (
      <svg className="w-3 h-3 text-[#DABD59] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="w-3 h-3 text-[#DABD59] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Google Maps window types ─────────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google: any
    initLandGoogleMaps?: () => void
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

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? 'w-5 h-5'}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

// ─── URL parser for manual comp entry ─────────────────────────────────────────

function parseCompUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    const hostname = url.hostname.replace('www.', '')

    if (hostname === 'zillow.com') {
      const match = url.pathname.match(/\/homedetails\/(.+?)\/([\d]+_zpid)?/)
      if (match) {
        return match[1].replace(/-/g, ' ').replace(/\//g, '')
      }
    }

    if (hostname === 'redfin.com') {
      const parts = url.pathname.split('/').filter(Boolean)
      // redfin.com/STATE/CITY/ADDRESS/...
      if (parts.length >= 3) {
        return parts.slice(2, 3).join(' ').replace(/-/g, ' ')
      }
    }

    if (hostname === 'realtor.com') {
      const match = url.pathname.match(/\/realestateandhomes-detail\/(.+?)(_M[\d]+)?$/)
      if (match) {
        return match[1].replace(/-/g, ' ')
      }
    }
  } catch {
    // not a URL
  }
  return null
}

// ─── Main component ───────────────────────────────────────────────────────────

function LandContent() {
  const searchParams = useSearchParams()
  const locationId = searchParams.get('locationId') ?? searchParams.get('token') ?? ''

  // ── Connection gate ─────────────────────────────────────────────────────────

  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')
  const [connectedBanner, setConnectedBanner] = useState(false)
  const [loadingDeal, setLoadingDeal] = useState(false)

  // ── Step state ──────────────────────────────────────────────────────────────

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1
  const [place, setPlace] = useState<PlaceSelection | null>(null)
  const [addressInput, setAddressInput] = useState('')

  // Step 2
  const [landInfo, setLandInfo] = useState<LandInfo>({
    lotSizeAcres: '',
    lotSizeSqft: 0,
    zoning: '',
    roadAccess: '',
    utilities: [],
    topography: '',
    notes: '',
  })
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [lotSizeUnit, setLotSizeUnit] = useState<'acres' | 'sqft'>('acres')

  // Step 3
  const [rawComps, setRawComps] = useState<LandComp[]>([])
  const [allComps, setAllComps] = useState<LandComp[]>([])
  const [fetchingComps, setFetchingComps] = useState(false)
  const [compsError, setCompsError] = useState('')
  const [filters, setFilters] = useState<LandFilters>({
    radius: 5,
    days: null,
    lotSizeRange: 0.5,
    lotType: 'all',
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [manuallySelected, setManuallySelected] = useState<Set<string>>(new Set())
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)
  const [showAddComp, setShowAddComp] = useState(false)

  // Manual comp form
  const [manualCompUrl, setManualCompUrl] = useState('')
  const [manualCompAddress, setManualCompAddress] = useState('')
  const [manualCompPrice, setManualCompPrice] = useState('')
  const [manualCompAcres, setManualCompAcres] = useState('')
  const [manualCompDate, setManualCompDate] = useState('')
  const [manualCompUrlError, setManualCompUrlError] = useState('')

  // Step 4
  const [analysis, setAnalysis] = useState<LandAnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1)
  const [tab2Unlocked, setTab2Unlocked] = useState(false)
  const [tab3Unlocked, setTab3Unlocked] = useState(false)

  // Tab 2 inputs
  const [discount, setDiscount] = useState(40)
  const [wholesaleFee, setWholesaleFee] = useState(5000)

  // Tab 3
  const [calcResults, setCalcResults] = useState<{
    keepPct: number
    endBuyerMax: number
    cashOffer: number
    anchorOffer: number
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<{ text: string; variant: 'success' | 'warning' | 'error' } | null>(null)

  // Save modal
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveModalSearching, setSaveModalSearching] = useState(false)
  const [saveModalContacts, setSaveModalContacts] = useState<CrmContact[]>([])
  const [saveModalSelection, setSaveModalSelection] = useState<string | 'new' | 'skip' | null>(null)
  const [saveModalSellerName, setSaveModalSellerName] = useState('')
  const [saveModalSaving, setSaveModalSaving] = useState(false)

  // Refs
  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<unknown>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const gMapRef = useRef<unknown>(null)
  const markersRef = useRef<Map<string, unknown>>(new Map())
  const circleRef = useRef<unknown>(null)
  const subjectMarkerRef = useRef<unknown>(null)

  const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ?? ''

  // ── Computed ────────────────────────────────────────────────────────────────

  const subjectAcres = typeof landInfo.lotSizeAcres === 'number' ? landInfo.lotSizeAcres : 0

  const filteredComps = useMemo<LandComp[]>(() => {
    return allComps.filter((c) => {
      if (c.distanceMiles > filters.radius) return false
      if (filters.days !== null && c.daysSinceSold !== null && c.daysSinceSold > filters.days) return false
      if (filters.lotSizeRange !== null && subjectAcres > 0 && c.lotSizeAcres !== null) {
        const ratio = Math.abs(c.lotSizeAcres - subjectAcres) / subjectAcres
        if (ratio > filters.lotSizeRange) return false
      }
      if (filters.lotType !== 'all' && c.lotSizeAcres !== null) {
        if (filters.lotType === 'infill' && c.lotSizeAcres >= 1) return false
        if (filters.lotType === 'acreage' && (c.lotSizeAcres < 1 || c.lotSizeAcres > 10)) return false
        if (filters.lotType === 'large' && c.lotSizeAcres <= 10) return false
      }
      return true
    })
  }, [allComps, filters, subjectAcres])

  const { tableComps, filteredIdsSet } = useMemo(() => {
    const filteredIdsSet = new Set(filteredComps.map((c) => c.id))
    const outsideFilter = allComps.filter(
      (c) => c.source === 'manual' && selectedIds.has(c.id) && !filteredIdsSet.has(c.id)
    )
    return { tableComps: [...filteredComps, ...outsideFilter], filteredIdsSet }
  }, [filteredComps, allComps, selectedIds])

  const sortedTableComps = useMemo(() => {
    if (!sortCol || !sortDir) return tableComps
    const dir = sortDir === 'asc' ? 1 : -1
    return [...tableComps].sort((a, b) => {
      switch (sortCol) {
        case 'address': return dir * a.address.localeCompare(b.address)
        case 'acres': return dir * ((a.lotSizeAcres ?? 0) - (b.lotSizeAcres ?? 0))
        case 'sold': return dir * ((a.daysSinceSold ?? 999999) - (b.daysSinceSold ?? 999999))
        case 'dist': return dir * (a.distanceMiles - b.distanceMiles)
        case 'price': return dir * ((a.lastSalePrice ?? 0) - (b.lastSalePrice ?? 0))
        default: return 0
      }
    })
  }, [tableComps, sortCol, sortDir])

  const allVisibleSelected = sortedTableComps.length > 0 && sortedTableComps.every((c) => selectedIds.has(c.id))
  const someVisibleSelected = sortedTableComps.some((c) => selectedIds.has(c.id))
  const selectedCount = selectedIds.size

  const selectedCompsForPayload = useMemo(() => {
    return allComps.filter((c) => selectedIds.has(c.id))
  }, [allComps, selectedIds])

  // ── Connection check ────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      setConnectionStatus('connected')
      setConnectedBanner(true)
      setTimeout(() => setConnectedBanner(false), 4000)
      const params = new URLSearchParams(searchParams.toString())
      params.delete('connected')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''))
      return
    }
    if (!locationId) {
      setConnectionStatus('disconnected')
      return
    }
    fetch(`/api/analyzer/check-connection?locationId=${encodeURIComponent(locationId)}`)
      .then((r) => r.json())
      .then((data) => setConnectionStatus(data.connected ? 'connected' : 'disconnected'))
      .catch(() => setConnectionStatus('disconnected'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deal reload via dealId URL param ────────────────────────────────────────

  useEffect(() => {
    if (connectionStatus !== 'connected') return
    const dealId = searchParams.get('dealId')
    if (!dealId || !locationId) return

    setLoadingDeal(true)
    fetch(`/api/analyzer/land-deal?dealId=${encodeURIComponent(dealId)}&locationId=${encodeURIComponent(locationId)}`)
      .then((r) => r.json())
      .then((deal) => {
        if (deal.error) return

        setPlace({ formattedAddress: deal.address, lat: deal.lat ?? 0, lng: deal.lng ?? 0 })
        setAddressInput(deal.address)
        setLandInfo({
          lotSizeAcres: deal.lotSizeAcres ?? '',
          lotSizeSqft: deal.lotSizeSqft ?? 0,
          zoning: deal.zoning ?? '',
          roadAccess: deal.roadAccess ?? '',
          utilities: deal.utilities ?? [],
          topography: deal.topography ?? '',
          notes: '',
        })

        if (deal.compsRawJson) {
          try {
            const rawCompsData: LandComp[] = JSON.parse(deal.compsRawJson)
            // Recalculate daysSinceSold fresh
            const fresh = rawCompsData.map((c) => ({
              ...c,
              daysSinceSold: c.lastSaleDate
                ? Math.floor((Date.now() - new Date(c.lastSaleDate).getTime()) / 86400000)
                : null,
            }))
            setRawComps(rawCompsData)
            setAllComps(fresh)
            if (deal.compsJson) {
              const selectedComps: { id: string }[] = JSON.parse(deal.compsJson)
              setSelectedIds(new Set(selectedComps.map((c) => c.id)))
            }
          } catch { /* corrupted */ }
        }

        const reconstructed: LandAnalysisResult = {
          comps: [],
          estimated_value: {
            estimate: deal.estimatedValue,
            low: deal.estimatedValueLow ?? 0,
            high: deal.estimatedValueHigh ?? 0,
            confidence: (deal.valueConfidence as 'high' | 'medium' | 'low') ?? 'medium',
            confidence_reason: '',
            value_method: (deal.valueMethod as 'comps' | 'tax_assessment' | 'hybrid') ?? 'comps',
          },
          builder_activity: {
            level: (deal.builderActivityLevel as 'high' | 'moderate' | 'low' | 'unknown') ?? 'unknown',
            note: deal.builderActivityNote ?? '',
          },
          exit_strategy: {
            recommendation: (deal.exitStrategy as LandAnalysisResult['exit_strategy']['recommendation']) ?? 'RETAIL_LOT_BUYER',
            reasoning: '',
          },
          narrative: deal.narrative ?? '',
          risks: deal.risks ?? [],
          warnings: deal.warnings ?? [],
        }
        setAnalysis(reconstructed)

        setDiscount(deal.discount ?? 40)
        setWholesaleFee(deal.wholesaleFee ?? 5000)

        if (deal.endBuyerMax != null && deal.cashOffer != null && deal.anchorOffer != null) {
          const keepPct = 1 - ((deal.discount ?? 40) / 100)
          setCalcResults({
            keepPct,
            endBuyerMax: deal.endBuyerMax,
            cashOffer: deal.cashOffer,
            anchorOffer: deal.anchorOffer,
          })
          setTab2Unlocked(true)
          setTab3Unlocked(true)
        }

        setStep(4)
        setActiveTab(1)
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingDeal(false))
  }, [connectionStatus]) // eslint-disable-line react-hooks/exhaustive-deps

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

    window.initLandGoogleMaps = () => {
      setGoogleMapsLoaded(true)
      initAutocomplete()
    }

    if (window.google?.maps) {
      setGoogleMapsLoaded(true)
      initAutocomplete()
      return
    }

    if (!document.getElementById('gmaps-land')) {
      const script = document.createElement('script')
      script.id = 'gmaps-land'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&callback=initLandGoogleMaps`
      script.async = true
      document.head.appendChild(script)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connectionStatus !== 'connected') return
    if (step === 1 && googleMapsLoaded && addressInputRef.current && !autocompleteRef.current) {
      initAutocomplete()
    }
  }, [step, googleMapsLoaded, connectionStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map ─────────────────────────────────────────────────────────────────────

  const updateCompMarkers = useCallback(() => {
    if (!gMapRef.current || !window.google?.maps) return
    const g = window.google.maps
    const filteredIds = new Set(filteredComps.map((c) => c.id))
    const allIds = new Set(allComps.map((c) => c.id))

    markersRef.current.forEach((marker, id) => {
      if (!allIds.has(id)) {
        (marker as { setMap: (m: null) => void }).setMap(null)
        markersRef.current.delete(id)
      }
    })

    allComps.forEach((comp) => {
      if (!comp.lat || !comp.lng) return
      const isFiltered = filteredIds.has(comp.id)
      const isSelected = selectedIds.has(comp.id)
      const isManual = comp.source === 'manual'

      const color = isManual
        ? '#f59e0b'
        : isSelected
        ? '#22c55e'
        : '#eab308'

      if (markersRef.current.has(comp.id)) {
        const m = markersRef.current.get(comp.id) as {
          setIcon: (i: unknown) => void
          setMap: (m: unknown) => void
        }
        if (!isFiltered && !isManual) {
          m.setMap(null)
        } else {
          m.setMap(gMapRef.current)
          m.setIcon({
            path: g.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#000000',
            strokeWeight: 1,
          })
        }
      } else if (isFiltered || isManual) {
        const marker = new g.Marker({
          position: { lat: comp.lat, lng: comp.lng },
          map: gMapRef.current,
          icon: {
            path: g.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#000000',
            strokeWeight: 1,
          },
          title: comp.address,
        })
        marker.addListener('click', () => {
          const compId = comp.id
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(compId)) next.delete(compId)
            else next.add(compId)
            return next
          })
          setManuallySelected((prev) => {
            const next = new Set(prev)
            next.add(comp.id)
            return next
          })
        })
        markersRef.current.set(comp.id, marker)
      }
    })
  }, [allComps, filteredComps, selectedIds])

  useEffect(() => {
    if (step !== 3 || !googleMapsLoaded || !place || !mapContainerRef.current || gMapRef.current) return

    const g = window.google.maps
    const map = new g.Map(mapContainerRef.current, {
      center: { lat: place.lat, lng: place.lng },
      zoom: 11,
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
  }, [step, allComps, selectedIds, updateCompMarkers])

  // ── Comp fetching ───────────────────────────────────────────────────────────

  async function fetchComps() {
    if (!place) return
    setFetchingComps(true)
    setCompsError('')
    try {
      const res = await fetch('/api/analyzer/land-comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: place.lat,
          lng: place.lng,
          lotSizeSqft: landInfo.lotSizeSqft,
          locationId,
          formattedAddress: place.formattedAddress,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setCompsError(d.error || 'Failed to fetch comps')
        return
      }
      const data: LandComp[] = await res.json()
      setRawComps(data)
      setAllComps(data)
    } catch {
      setCompsError('Network error fetching comps. Try again.')
    } finally {
      setFetchingComps(false)
    }
  }

  useEffect(() => {
    if (step === 3 && allComps.length === 0 && !fetchingComps) {
      fetchComps()
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect lot type on step 3 entry
  useEffect(() => {
    if (step === 3 && subjectAcres > 0) {
      setFilters((f) => ({ ...f, lotType: autoDetectLotType(subjectAcres) }))
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analysis ────────────────────────────────────────────────────────────────

  async function runAnalysis() {
    if (!place) return
    setAnalyzing(true)
    setAnalysisError('')
    setTab2Unlocked(false)
    setTab3Unlocked(false)
    setCalcResults(null)
    setActiveTab(1)

    try {
      const result = await analyzeLand({
        subject: {
          address: place.formattedAddress,
          lat: place.lat,
          lng: place.lng,
          lotSizeSqft: landInfo.lotSizeSqft,
          lotSizeAcres: subjectAcres,
          zoning: landInfo.zoning || null,
          roadAccess: landInfo.roadAccess || null,
          utilities: landInfo.utilities,
          topography: landInfo.topography || null,
          notes: landInfo.notes || null,
        },
        comps: selectedCompsForPayload,
        contextParcels: allComps.filter((c) => !selectedIds.has(c.id)),
        locationId,
      })
      setAnalysis(result)
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
    const ev = analysis.estimated_value.estimate
    const keepPct = 1 - (discount / 100)
    const endBuyerMax = ev * keepPct
    const cashOffer = endBuyerMax - wholesaleFee
    const anchorOffer = cashOffer * 0.8
    setCalcResults({ keepPct, endBuyerMax, cashOffer, anchorOffer })
    setTab3Unlocked(true)
    setActiveTab(3)
  }

  // ── Save flow ───────────────────────────────────────────────────────────────

  function openSaveModal() {
    if (!place || !analysis || !calcResults) return
    setSaveModalOpen(true)
    setSaveModalSearching(true)
    setSaveModalContacts([])
    setSaveModalSelection(null)
    setSaveModalSellerName('')
    fetch('/api/analyzer/search-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, address: place.formattedAddress }),
    })
      .then((r) => r.json())
      .then((data) => setSaveModalContacts(data.contacts ?? []))
      .catch(() => setSaveModalContacts([]))
      .finally(() => setSaveModalSearching(false))
  }

  async function performSave(contactId: string | null, skipGhl: boolean) {
    if (!place || !analysis || !calcResults) return
    setSaving(true)
    setSaveModalSaving(true)
    try {
      const payload = {
        locationId,
        address: place.formattedAddress,
        lat: place.lat,
        lng: place.lng,
        lotSizeSqft: landInfo.lotSizeSqft,
        lotSizeAcres: subjectAcres,
        zoning: landInfo.zoning || null,
        roadAccess: landInfo.roadAccess || null,
        utilities: landInfo.utilities,
        topography: landInfo.topography || null,
        estimatedValue: analysis.estimated_value.estimate,
        estimatedValueLow: analysis.estimated_value.low,
        estimatedValueHigh: analysis.estimated_value.high,
        valueConfidence: analysis.estimated_value.confidence,
        valueMethod: analysis.estimated_value.value_method,
        builderActivityLevel: analysis.builder_activity.level,
        builderActivityNote: analysis.builder_activity.note,
        exitStrategy: analysis.exit_strategy.recommendation,
        narrative: analysis.narrative,
        risks: analysis.risks,
        warnings: analysis.warnings,
        discount,
        endBuyerMax: calcResults.endBuyerMax,
        wholesaleFee,
        cashOffer: calcResults.cashOffer,
        anchorOffer: calcResults.anchorOffer,
        compsJson: JSON.stringify(selectedCompsForPayload),
        compsRawJson: JSON.stringify(rawComps),
        contactId,
        skipGhl,
      }
      const res = await fetch('/api/analyzer/land-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      setSaveModalOpen(false)
      if (!res.ok) {
        setSaveFeedback({ text: data.error || 'Save failed. Try again.', variant: 'error' })
      } else if (skipGhl) {
        setSaveFeedback({ text: 'Saved locally.', variant: 'success' })
      } else if (data.ghlSynced) {
        setSaveFeedback({ text: 'Saved and synced to CRM.', variant: 'success' })
      } else {
        setSaveFeedback({ text: 'Saved locally. CRM sync failed — click again to retry.', variant: 'warning' })
      }
    } catch {
      setSaveFeedback({ text: 'Network error. Try again.', variant: 'error' })
      setSaveModalOpen(false)
    } finally {
      setSaving(false)
      setSaveModalSaving(false)
      setTimeout(() => setSaveFeedback(null), 4000)
    }
  }

  async function handleSaveModalConfirm() {
    if (!saveModalSelection) return
    if (saveModalSelection === 'skip') {
      await performSave(null, true)
      return
    }
    if (saveModalSelection === 'new') {
      if (!saveModalSellerName.trim() || !place) return
      setSaveModalSaving(true)
      let newContactId: string | null = null
      try {
        const nameParts = saveModalSellerName.trim().split(/\s+/)
        const firstName = nameParts[0] ?? ''
        const lastName = nameParts.slice(1).join(' ')
        const res = await fetch('/api/analyzer/create-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId, firstName, lastName, address1: place.formattedAddress }),
        })
        if (res.ok) {
          const data = await res.json()
          newContactId = data.contactId ?? null
        }
      } catch { /* proceed without contactId */ }
      await performSave(newContactId, false)
      return
    }
    await performSave(saveModalSelection, false)
  }

  // ── Manual comp entry ────────────────────────────────────────────────────────

  function handleManualCompUrlBlur() {
    const parsed = parseCompUrl(manualCompUrl)
    if (parsed) {
      setManualCompAddress(parsed)
      setManualCompUrlError('')
    } else if (manualCompUrl.trim() && manualCompUrl.trim().startsWith('http')) {
      setManualCompUrlError('Could not parse URL. Enter the address manually below.')
    }
  }

  function addManualComp() {
    if (!manualCompAddress.trim() || !manualCompPrice || !manualCompAcres || !manualCompDate) return
    const acres = parseFloat(manualCompAcres)
    const price = parseFloat(manualCompPrice)
    const sqft = Math.round(acres * 43560)
    const daysSinceSold = manualCompDate
      ? Math.floor((Date.now() - new Date(manualCompDate).getTime()) / 86400000)
      : null
    const id = `manual-${Date.now()}`
    const newComp: LandComp = {
      id,
      address: manualCompAddress.trim(),
      lat: null,
      lng: null,
      lotSizeSqft: sqft,
      lotSizeAcres: acres,
      zoning: null,
      lastSalePrice: price,
      lastSaleDate: manualCompDate,
      taxAssessedLandValue: null,
      hasStructure: false,
      ownerType: null,
      subdivision: null,
      source: 'manual',
      priceSource: 'sale',
      pricePerSqft: sqft > 0 ? parseFloat((price / sqft).toFixed(2)) : null,
      pricePerAcre: acres > 0 ? Math.round(price / acres) : null,
      daysSinceSold,
      distanceMiles: 0,
    }
    setAllComps((prev) => [...prev, newComp])
    setSelectedIds((prev) => { const n = new Set(prev); n.add(id); return n })
    setManuallySelected((prev) => { const n = new Set(prev); n.add(id); return n })
    setShowAddComp(false)
    setManualCompUrl('')
    setManualCompAddress('')
    setManualCompPrice('')
    setManualCompAcres('')
    setManualCompDate('')
    setManualCompUrlError('')
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  function validateStep2(): boolean {
    const errs: Record<string, string> = {}
    if (landInfo.lotSizeAcres === '') errs.lotSizeAcres = 'Lot size is required'
    setValidationErrors(errs)
    return Object.keys(errs).length === 0
  }

  function toggleComp(id: string) {
    const isCurrentlySelected = selectedIds.has(id)
    if (isCurrentlySelected) {
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      setManuallySelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); n.add(id); return n })
      setManuallySelected((prev) => { const n = new Set(prev); n.add(id); return n })
    }
  }

  function handleSort(col: string) {
    if (sortCol !== col) {
      setSortCol(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortCol(null)
      setSortDir(null)
    }
  }

  function resetAll() {
    setStep(1)
    setPlace(null)
    setAddressInput('')
    setLandInfo({ lotSizeAcres: '', lotSizeSqft: 0, zoning: '', roadAccess: '', utilities: [], topography: '', notes: '' })
    setRawComps([])
    setAllComps([])
    setSelectedIds(new Set())
    setManuallySelected(new Set())
    setFilters({ radius: 5, days: null, lotSizeRange: 0.5, lotType: 'all' })
    setSortCol(null)
    setSortDir(null)
    setAnalysis(null)
    setAnalysisError('')
    setActiveTab(1)
    setTab2Unlocked(false)
    setTab3Unlocked(false)
    setCalcResults(null)
    setSaveFeedback(null)
    setSaveModalOpen(false)
    setSaveModalContacts([])
    setSaveModalSelection(null)
    setSaveModalSellerName('')
    setSaveModalSaving(false)
    gMapRef.current = null
    markersRef.current.clear()
    circleRef.current = null
    subjectMarkerRef.current = null
    autocompleteRef.current = null
  }

  // ── Connection: checking ─────────────────────────────────────────────────────

  if (connectionStatus === 'checking') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Spinner className="w-8 h-8 text-white/20" />
      </div>
    )
  }

  // ── Connection: disconnected ─────────────────────────────────────────────────

  if (connectionStatus === 'disconnected') {
    const installUrl =
      `https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation` +
      `?response_type=code` +
      `&redirect_uri=${encodeURIComponent('https://tools.reiblast.app/api/analyzer/callback')}` +
      `&client_id=${process.env.NEXT_PUBLIC_GHL_CLIENT_ID ?? ''}` +
      `&scope=contacts.readonly+contacts.write+locations.readonly` +
      `&state=${locationId ?? ''}`

    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="bg-surface border border-border-default rounded-2xl p-8 max-w-[420px] w-full text-center">
          <div className="w-14 h-14 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-7 h-7 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Connect your account</h2>
          <p className="text-white/50 text-sm leading-relaxed mb-8">
            To use the REIblast Deal Analyzer, you need to connect your account. This only takes 30 seconds and is a one-time setup.
          </p>
          <button
            onClick={() => { window.location.href = installUrl }}
            className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors mb-4"
          >
            Connect now
          </button>
          <p className="text-white/30 text-xs">You&apos;ll be redirected back automatically.</p>
        </div>
      </div>
    )
  }

  if (loadingDeal) {
    return (
      <div className="min-h-screen bg-black text-white">
        <MinimalHeader title="Land Analyzer" />
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="max-w-3xl mx-auto">
            <AnalysisSkeleton />
          </div>
        </div>
      </div>
    )
  }

  // ── Connected: full analyzer ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white">

      {connectedBanner && (
        <div className="bg-green-400/10 border-b border-green-400/20 px-4 py-3 text-center">
          <p className="text-green-400 text-sm font-medium">Account connected. You&apos;re ready to analyze deals.</p>
        </div>
      )}

      <MinimalHeader title="Land Analyzer" />

      {/* ── Save modal ── */}
      {saveModalOpen && place && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-4">
          <div className="bg-surface border border-border-default rounded-2xl p-6 max-w-[440px] w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-1">Save deal to REIblast</h2>
            <p className="text-white/40 text-sm mb-6 truncate">{place.formattedAddress}</p>

            {saveModalSearching ? (
              <div className="flex items-center justify-center gap-2 py-10 text-white/40 text-sm">
                <Spinner className="w-4 h-4" />
                <span>Searching your CRM...</span>
              </div>
            ) : (
              <div className="space-y-1 mb-6">
                {saveModalContacts.map((contact) => (
                  <label
                    key={contact.id}
                    className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                      saveModalSelection === contact.id ? 'border-gold bg-gold/5' : 'border-transparent hover:border-border-default'
                    }`}
                  >
                    <input
                      type="radio"
                      name="save-contact"
                      value={contact.id}
                      checked={saveModalSelection === contact.id}
                      onChange={() => setSaveModalSelection(contact.id)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm">{capitalizeName(contact.name)}</p>
                      {contact.phone && <p className="text-white/40 text-xs mt-0.5">{contact.phone}</p>}
                      {contact.address && <p className="text-white/30 text-xs mt-0.5 truncate">{contact.address}</p>}
                    </div>
                  </label>
                ))}
                {saveModalContacts.length > 0 && <div className="border-t border-border-default my-2" />}
                <label
                  className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                    saveModalSelection === 'new' ? 'border-gold bg-gold/5' : 'border-transparent hover:border-border-default'
                  }`}
                >
                  <input
                    type="radio"
                    name="save-contact"
                    value="new"
                    checked={saveModalSelection === 'new'}
                    onChange={() => setSaveModalSelection('new')}
                    className="mt-0.5 accent-gold shrink-0"
                  />
                  <div className="min-w-0 w-full">
                    <p className="text-white/60 text-sm italic">Not in CRM</p>
                  </div>
                </label>
                {saveModalSelection === 'new' && (
                  <div className="pl-7 pt-1">
                    <input
                      type="text"
                      value={saveModalSellerName}
                      onChange={(e) => setSaveModalSellerName(e.target.value)}
                      placeholder="Full name"
                      autoFocus
                      className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/30"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setSaveModalOpen(false)}
                disabled={saveModalSaving}
                className="flex-1 border border-border-default text-white/50 font-semibold py-3 rounded-xl hover:border-white/20 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveModalConfirm}
                disabled={
                  saveModalSearching ||
                  saveModalSaving ||
                  !saveModalSelection ||
                  (saveModalSelection === 'new' && !saveModalSellerName.trim())
                }
                className="flex-1 bg-gold text-black font-bold py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saveModalSaving ? <><Spinner className="w-4 h-4" />Saving…</> : 'Save Deal →'}
              </button>
            </div>
            <button
              onClick={() => performSave(null, true)}
              disabled={saveModalSaving}
              className="w-full text-white/30 text-xs py-3 hover:text-white/60 transition-colors text-center mt-1 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Skip and save locally only
            </button>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6">
        <StepProgress step={step} />

        {/* ── STEP 1: Address ── */}
        {step === 1 && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-xl font-bold mb-2 text-center">Enter the land address</h2>
            <p className="text-white/40 text-sm mb-8 text-center">We&apos;ll pull comparable land sales in the area.</p>
            <div className="relative mb-3">
              <input
                ref={addressInputRef}
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="123 County Road 42, Waco TX"
                className="w-full bg-surface-2 text-white rounded-xl border border-border-default focus:border-gold px-5 py-4 text-base outline-none transition-colors placeholder:text-white/30"
              />
            </div>
            <p className="text-white/30 text-xs text-center">Select from the dropdown — we need the coordinates.</p>
          </div>
        )}

        {/* ── STEP 2: Property Confirmation ── */}
        {step === 2 && place && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-bold mb-1">Confirm land details</h2>
            <p className="text-white/40 text-sm mb-6">Fill in what you know. More detail = more accurate analysis.</p>

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
                  src={`https://maps.googleapis.com/maps/api/staticmap?center=${place.lat},${place.lng}&zoom=17&size=600x300&maptype=satellite&key=${MAPS_KEY}`}
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

            {/* Lot size — required */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-white/40 text-xs uppercase tracking-wider">
                  Lot Size <span className="text-red-400">*</span>
                </label>
                <div className="flex rounded-lg overflow-hidden border border-border-default text-xs font-medium">
                  {(['acres', 'sqft'] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => {
                        if (unit === lotSizeUnit) return
                        setLotSizeUnit(unit)
                        setValidationErrors((prev) => ({ ...prev, lotSizeAcres: '' }))
                      }}
                      className={`px-3 py-1 transition-colors ${
                        lotSizeUnit === unit
                          ? 'bg-gold text-black'
                          : 'bg-surface-2 text-white/40 hover:text-white'
                      }`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                value={
                  lotSizeUnit === 'acres'
                    ? landInfo.lotSizeAcres === '' ? '' : landInfo.lotSizeAcres
                    : landInfo.lotSizeSqft === 0 ? '' : landInfo.lotSizeSqft
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (lotSizeUnit === 'acres') {
                    const acres = v === '' ? '' : parseFloat(parseFloat(v).toFixed(2))
                    setLandInfo((prev) => ({
                      ...prev,
                      lotSizeAcres: acres,
                      lotSizeSqft: typeof acres === 'number' ? Math.round(acres * 43560) : 0,
                    }))
                  } else {
                    const sqft = v === '' ? 0 : Math.round(Number(v))
                    setLandInfo((prev) => ({
                      ...prev,
                      lotSizeSqft: sqft,
                      lotSizeAcres: sqft > 0 ? parseFloat((sqft / 43560).toFixed(2)) : '',
                    }))
                  }
                  setValidationErrors((prev) => ({ ...prev, lotSizeAcres: '' }))
                }}
                placeholder={lotSizeUnit === 'acres' ? '2.50' : '108,900'}
                min="0"
                step={lotSizeUnit === 'acres' ? '0.01' : '1'}
                className={`w-full max-w-xs bg-surface-2 text-white rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/20 ${
                  validationErrors.lotSizeAcres ? 'border-red-500' : 'border-border-default focus:border-gold'
                }`}
              />
              {validationErrors.lotSizeAcres && (
                <p className="text-red-400 text-xs mt-1">{validationErrors.lotSizeAcres}</p>
              )}
              {typeof landInfo.lotSizeAcres === 'number' && landInfo.lotSizeAcres > 0 && (
                <p className="text-white/30 text-xs mt-1">
                  {lotSizeUnit === 'acres'
                    ? `${landInfo.lotSizeSqft.toLocaleString()} sqft`
                    : `${landInfo.lotSizeAcres.toFixed(2)} acres`}
                </p>
              )}
            </div>

            {/* Optional fields */}
            <p className="text-white/30 text-xs mb-4 italic">Helps improve analysis (optional)</p>

            {/* Zoning */}
            <div className="mb-5">
              <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">Zoning</label>
              <input
                type="text"
                value={landInfo.zoning}
                onChange={(e) => setLandInfo((p) => ({ ...p, zoning: e.target.value }))}
                placeholder="R-1, AG, MF-2, etc."
                className="w-full max-w-xs bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/20"
              />
            </div>

            {/* Road access */}
            <div className="mb-5">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Road Access</p>
              <div className="flex gap-2">
                {(['yes', 'no', 'unknown'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setLandInfo((p) => ({ ...p, roadAccess: v }))}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                      landInfo.roadAccess === v
                        ? 'bg-gold text-black border-gold'
                        : 'bg-surface-2 text-white/50 border-border-default hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Utilities */}
            <div className="mb-5">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Utilities</p>
              <div className="flex flex-wrap gap-2">
                {(['Water', 'Sewer', 'Electric', 'Gas'] as const).map((u) => {
                  const on = landInfo.utilities.includes(u)
                  return (
                    <button
                      key={u}
                      onClick={() =>
                        setLandInfo((p) => ({
                          ...p,
                          utilities: on ? p.utilities.filter((x) => x !== u) : [...p.utilities, u],
                        }))
                      }
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        on
                          ? 'bg-gold/20 border-gold text-gold'
                          : 'bg-surface-2 border-border-default text-white/50 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {u}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Topography */}
            <div className="mb-5">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Topography</p>
              <div className="flex gap-2 flex-wrap">
                {(['flat', 'sloped', 'mixed', 'unknown'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setLandInfo((p) => ({ ...p, topography: v }))}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                      landInfo.topography === v
                        ? 'bg-gold text-black border-gold'
                        : 'bg-surface-2 text-white/50 border-border-default hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Seller notes */}
            <div className="mb-8">
              <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">Seller Notes</label>
              <textarea
                value={landInfo.notes}
                onChange={(e) => setLandInfo((p) => ({ ...p, notes: e.target.value.slice(0, 500) }))}
                placeholder="Anything else about this property..."
                rows={3}
                className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/20 resize-none"
              />
              <p className="text-white/20 text-xs mt-1 text-right">{landInfo.notes.length}/500</p>
            </div>

            <button
              onClick={() => { if (validateStep2()) setStep(3) }}
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
          <div className="relative flex flex-col gap-4">

            {/* Map */}
            <div className="relative rounded-xl overflow-hidden border border-border-default" style={{ height: '40vh', minHeight: 240 }}>
              <div ref={mapContainerRef} className="w-full h-full" />
              {!googleMapsLoaded && <Skeleton className="absolute inset-0" />}
            </div>

            {/* Map legend */}
            <div className="flex items-center gap-4 px-1 text-xs text-white/40">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#F5C842] inline-block" />
                Subject
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#22c55e] inline-block" />
                Selected comp
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#eab308] inline-block" />
                Unselected comp
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#f59e0b] inline-block" />
                Manual comp
              </span>
            </div>

            {/* Filter bar */}
            <div className="bg-surface border border-border-default rounded-xl p-3">
              <div className="grid grid-cols-4 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">Radius</label>
                  <select
                    value={filters.radius}
                    onChange={(e) => setFilters((f) => ({ ...f, radius: Number(e.target.value) as LandFilters['radius'] }))}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value={1}>1 mi</option>
                    <option value={2}>2 mi</option>
                    <option value={5}>5 mi</option>
                    <option value={10}>10 mi</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">Sold within</label>
                  <select
                    value={filters.days ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setFilters((f) => ({ ...f, days: v === '' ? null : (Number(v) as LandFilters['days'] & number) }))
                    }}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value="">Any</option>
                    <option value={180}>6 months</option>
                    <option value={365}>1 year</option>
                    <option value={730}>2 years</option>
                    <option value={1095}>3 years</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">Lot size</label>
                  <select
                    value={filters.lotSizeRange ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setFilters((f) => ({ ...f, lotSizeRange: v === '' ? null : (Number(v) as LandFilters['lotSizeRange'] & number) }))
                    }}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value={0.25}>±25%</option>
                    <option value={0.5}>±50%</option>
                    <option value={1}>±100%</option>
                    <option value="">Any</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">Lot type</label>
                  <select
                    value={filters.lotType}
                    onChange={(e) => setFilters((f) => ({ ...f, lotType: e.target.value as LandFilters['lotType'] }))}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value="all">All</option>
                    <option value="infill">Infill &lt;1 ac</option>
                    <option value="acreage">Acreage 1-10 ac</option>
                    <option value="large">Large 10+ ac</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Comp count row */}
            <div className="flex items-center justify-between px-1">
              <p className="text-white/50 text-sm">
                {allComps.length} properties loaded · {sortedTableComps.length} shown · {selectedCount} selected
              </p>
              <button
                onClick={() => setShowAddComp((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-gold border border-gold/30 rounded-lg px-3 py-1.5 hover:border-gold hover:bg-gold/5 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add comp
              </button>
            </div>

            {/* 0 comps warning */}
            {!fetchingComps && selectedCount === 0 && (
              <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 text-yellow-400 text-sm">
                No comps selected. Analysis will use tax assessment data only and have low confidence.
              </div>
            )}

            {/* Manual comp form */}
            {showAddComp && (
              <div className="bg-surface border border-border-default rounded-xl p-4 space-y-3">
                <p className="text-white font-semibold text-sm">Add manual comp</p>
                <div>
                  <label className="block text-white/30 text-xs mb-1">Paste Zillow, Redfin, or Realtor.com URL (optional)</label>
                  <input
                    type="url"
                    value={manualCompUrl}
                    onChange={(e) => setManualCompUrl(e.target.value)}
                    onBlur={handleManualCompUrlBlur}
                    placeholder="https://www.zillow.com/homedetails/..."
                    className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2 text-sm outline-none placeholder:text-white/20"
                  />
                  {manualCompUrlError && <p className="text-yellow-400 text-xs mt-1">{manualCompUrlError}</p>}
                </div>
                <div>
                  <label className="block text-white/30 text-xs mb-1">Address</label>
                  <input
                    type="text"
                    value={manualCompAddress}
                    onChange={(e) => setManualCompAddress(e.target.value)}
                    placeholder="123 Main St, Dallas TX"
                    className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2 text-sm outline-none placeholder:text-white/20"
                  />
                </div>
                {manualCompAddress.trim() && MAPS_KEY && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${encodeURIComponent(manualCompAddress)}&key=${MAPS_KEY}`}
                    alt="Street view"
                    className="w-full h-28 object-cover rounded-lg"
                  />
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-white/30 text-xs mb-1">Sale price ($) *</label>
                    <input
                      type="number"
                      value={manualCompPrice}
                      onChange={(e) => setManualCompPrice(e.target.value)}
                      placeholder="75000"
                      min="0"
                      className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2 text-sm outline-none placeholder:text-white/20"
                    />
                  </div>
                  <div>
                    <label className="block text-white/30 text-xs mb-1">Lot size (acres) *</label>
                    <input
                      type="number"
                      value={manualCompAcres}
                      onChange={(e) => setManualCompAcres(e.target.value)}
                      placeholder="1.25"
                      min="0"
                      step="0.01"
                      className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2 text-sm outline-none placeholder:text-white/20"
                    />
                  </div>
                  <div>
                    <label className="block text-white/30 text-xs mb-1">Date sold *</label>
                    <input
                      type="date"
                      value={manualCompDate}
                      onChange={(e) => setManualCompDate(e.target.value)}
                      className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={addManualComp}
                    disabled={!manualCompAddress.trim() || !manualCompPrice || !manualCompAcres || !manualCompDate}
                    className="bg-gold text-black font-bold px-4 py-2 rounded-lg text-sm hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add comp
                  </button>
                  <button
                    onClick={() => { setShowAddComp(false); setManualCompUrl(''); setManualCompAddress(''); setManualCompPrice(''); setManualCompAcres(''); setManualCompDate(''); setManualCompUrlError('') }}
                    className="text-white/40 text-sm py-2 px-3 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Comp table */}
            {fetchingComps ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((k) => (
                  <div key={k} className="bg-surface border border-border-default rounded-xl p-4 flex gap-3">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : compsError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-3">{compsError}</p>
                <button onClick={() => fetchComps()} className="text-gold hover:underline text-sm">Try again</button>
              </div>
            ) : sortedTableComps.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-10">
                No comparable land sales found. Try expanding filters or add comps manually.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border-default">
                <table style={{ tableLayout: 'fixed', width: '100%', minWidth: 680 }}>
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: 200 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border-default bg-surface">
                      <th className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }}
                          onChange={(e) => {
                            const ids = sortedTableComps.map((c) => c.id)
                            if (e.target.checked) {
                              setSelectedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n })
                              setManuallySelected((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n })
                            } else {
                              const toRemove = new Set(ids)
                              setSelectedIds((prev) => { const n = new Set(prev); toRemove.forEach((id) => n.delete(id)); return n })
                              setManuallySelected((prev) => { const n = new Set(prev); toRemove.forEach((id) => n.delete(id)); return n })
                            }
                          }}
                          style={{ accentColor: '#DABD59' }}
                          className="cursor-pointer"
                        />
                      </th>
                      {(
                        [
                          { key: 'address', label: 'Address', align: 'left' as const },
                          { key: 'acres', label: 'Acres', align: 'right' as const },
                          { key: 'zoning', label: 'Zoning', align: 'left' as const },
                          { key: 'sold', label: 'Sold', align: 'left' as const },
                          { key: 'dist', label: 'Dist', align: 'right' as const },
                        ]
                      ).map(({ key, label, align }) => (
                        <th
                          key={key}
                          onClick={() => key !== 'zoning' ? handleSort(key) : undefined}
                          className={`p-2 text-[11px] font-medium uppercase tracking-wider select-none ${
                            key !== 'zoning' ? 'cursor-pointer' : ''
                          } ${sortCol === key ? 'text-white' : 'text-white/40'} ${align === 'right' ? 'text-right' : 'text-left'}`}
                        >
                          <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
                            {label}
                            {key !== 'zoning' && <SortIndicator col={key} sortCol={sortCol} sortDir={sortDir} />}
                          </span>
                        </th>
                      ))}
                      <th
                        onClick={() => handleSort('price')}
                        className={`p-2 text-right text-[11px] font-medium uppercase tracking-wider cursor-pointer select-none ${sortCol === 'price' ? 'text-white' : 'text-white/40'}`}
                      >
                        <span className="inline-flex items-center gap-0.5 justify-end">
                          Sale Price
                          <SortIndicator col="price" sortCol={sortCol} sortDir={sortDir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {sortedTableComps.map((comp) => {
                      const selected = selectedIds.has(comp.id)
                      const isOutsideFilter = !filteredIdsSet.has(comp.id)
                      const isManual = comp.source === 'manual'
                      return (
                        <tr
                          key={comp.id}
                          onClick={() => toggleComp(comp.id)}
                          className={`cursor-pointer transition-colors hover:bg-surface-2 ${isOutsideFilter && !isManual ? 'opacity-70' : ''}`}
                        >
                          <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleComp(comp.id)}
                              style={{ accentColor: '#DABD59' }}
                              className="cursor-pointer"
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-[13px] text-white truncate leading-tight">{comp.address}</p>
                              {isManual && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-medium">Manual</span>
                              )}
                              {isOutsideFilter && !isManual && (
                                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400 font-medium">outside filter</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.lotSizeAcres != null ? comp.lotSizeAcres.toFixed(2) + ' ac' : '—'}
                          </td>
                          <td className="p-2 text-[13px] text-white/60 truncate">
                            {comp.zoning ?? '—'}
                          </td>
                          <td className="p-2 text-[13px] text-white/80">
                            {comp.daysSinceSold != null ? relativeDate(comp.daysSinceSold) : '—'}
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.distanceMiles > 0 ? comp.distanceMiles.toFixed(1) + ' mi' : '—'}
                          </td>
                          <td className="p-2 text-right">
                            {comp.priceSource === 'none' ? (
                              <p className="text-[13px] text-white/30 italic">No data</p>
                            ) : (
                              <div>
                                <p className="text-[13px] font-medium text-white">
                                  {fmt(comp.lastSalePrice)}
                                </p>
                                {comp.priceSource === 'assessment' && (
                                  <p className="text-[10px] text-white/30">Assessed</p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sticky run analysis bar */}
            <div
              className="sticky bottom-0 bg-surface-2 flex items-center justify-between gap-4 z-10"
              style={{ borderTop: '0.5px solid #2A2A2A', padding: '10px 14px' }}
            >
              <div>
                {analyzing ? (
                  <p className="text-white/50 text-sm">Analyzing… this takes 10–20 seconds</p>
                ) : (
                  <p className="text-white/50 text-sm">{selectedCount} comp{selectedCount !== 1 ? 's' : ''} selected</p>
                )}
              </div>
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shrink-0 ${
                  analyzing
                    ? 'bg-surface border border-border-default text-white/20 cursor-not-allowed'
                    : selectedCount === 0
                    ? 'bg-yellow-400/80 text-black hover:bg-yellow-400'
                    : 'bg-[#DABD59] text-black hover:bg-gold-hover'
                }`}
              >
                {analyzing ? (
                  <><Spinner className="w-4 h-4" />Analyzing…</>
                ) : (
                  <>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                      <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
                    </svg>
                    {selectedCount === 0 ? 'Run analysis (limited data)' : 'Run analysis'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Results ── */}
        {step === 4 && (
          <div className="max-w-3xl mx-auto">
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
                    <button onClick={() => setStep(3)} className="text-gold hover:underline text-sm">← Back to comps</button>
                  </div>
                ) : analysis ? (
                  <div className="space-y-5">
                    {/* Re-run button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          gMapRef.current = null
                          markersRef.current.clear()
                          circleRef.current = null
                          subjectMarkerRef.current = null
                          setStep(3)
                        }}
                        disabled={allComps.length === 0}
                        className="flex items-center gap-1.5 text-sm text-white/40 border border-border-default rounded-lg px-3 py-1.5 hover:text-white hover:border-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                        Re-run with different comps
                      </button>
                    </div>

                    {/* Value + Builder Activity cards */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-surface border border-gold rounded-xl p-5">
                        <p className="text-gold text-[10px] uppercase tracking-wider mb-1">Estimated Value</p>
                        <p className="text-white/40 text-xs mb-1">
                          {fmt(analysis.estimated_value.low)} — {fmt(analysis.estimated_value.high)}
                        </p>
                        <p className="text-white text-2xl font-bold mb-2">{fmt(analysis.estimated_value.estimate)}</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            analysis.estimated_value.confidence === 'high'
                              ? 'bg-green-400/15 text-green-400'
                              : analysis.estimated_value.confidence === 'medium'
                              ? 'bg-yellow-400/15 text-yellow-400'
                              : 'bg-red-400/15 text-red-400'
                          }`}>
                            {analysis.estimated_value.confidence} confidence
                          </span>
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-white/5 text-white/50 capitalize">
                            {analysis.estimated_value.value_method.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-white/30 text-[11px] italic leading-relaxed">{analysis.estimated_value.confidence_reason}</p>
                      </div>

                      <div className="bg-surface border border-border-default rounded-xl p-5">
                        <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Builder Activity</p>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mb-3 ${
                          analysis.builder_activity.level === 'high'
                            ? 'bg-green-400/15 text-green-400'
                            : analysis.builder_activity.level === 'moderate'
                            ? 'bg-yellow-400/15 text-yellow-400'
                            : analysis.builder_activity.level === 'low'
                            ? 'bg-white/5 text-white/50'
                            : 'bg-white/5 text-white/30'
                        }`}>
                          {analysis.builder_activity.level}
                        </span>
                        <p className="text-white/60 text-xs leading-relaxed">{analysis.builder_activity.note}</p>
                      </div>
                    </div>

                    {/* Subject chips */}
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { label: 'Lot Size', value: subjectAcres > 0 ? `${subjectAcres.toFixed(2)} ac` : null },
                        { label: 'Zoning', value: landInfo.zoning || null },
                        { label: 'Road Access', value: landInfo.roadAccess || null },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-surface-2 rounded-lg px-3 py-2">
                          <p className="text-white/30 text-[10px]">{label}</p>
                          <p className={`font-semibold text-sm ${value ? 'text-white' : 'text-white/30'}`}>
                            {value ?? 'Not provided'}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Comp breakdown */}
                    {analysis.comps.length > 0 && (
                      <div>
                        <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Comp Breakdown</p>
                        <div className="space-y-2">
                          {analysis.comps.map((comp, i) => (
                            <div key={i} className="bg-surface border border-border-default rounded-xl p-4">
                              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                <p className="text-white text-xs font-semibold truncate">{comp.address}</p>
                                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  comp.classification === 'VACANT_LAND'
                                    ? 'bg-green-400/15 text-green-400'
                                    : comp.classification === 'TEARDOWN'
                                    ? 'bg-orange-400/15 text-orange-400'
                                    : 'bg-white/5 text-white/40'
                                }`}>
                                  {comp.classification.replace('_', ' ')}
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
                                {comp.source === 'manual' && (
                                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-medium">Manual</span>
                                )}
                              </div>
                              <div className="grid grid-cols-4 gap-3 mt-2">
                                <div>
                                  <p className="text-white/25 text-[10px]">Lot size</p>
                                  <p className="text-white/70 text-xs font-medium">
                                    {comp.lotSizeAcres != null ? comp.lotSizeAcres.toFixed(2) + ' ac' : '—'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-white/25 text-[10px]">Sale price</p>
                                  <p className="text-white/70 text-xs font-medium">
                                    {fmt(comp.lastSalePrice)}
                                    {comp.priceSource === 'assessment' && (
                                      <span className="ml-1 text-[9px] text-white/30">Assessed</span>
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-white/25 text-[10px]">Tax assessed</p>
                                  <p className="text-white/70 text-xs font-medium">{fmt(comp.taxAssessedLandValue)}</p>
                                </div>
                                <div>
                                  <p className="text-white/25 text-[10px]">Days since sold</p>
                                  <p className="text-white/70 text-xs font-medium">
                                    {comp.daysSinceSold != null ? relativeDate(comp.daysSinceSold) : '—'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Exit strategy */}
                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-2">Exit Strategy</p>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold mb-3 ${
                        analysis.exit_strategy.recommendation === 'BUILDER_SALE'
                          ? 'bg-blue-400/15 text-blue-400'
                          : analysis.exit_strategy.recommendation === 'RETAIL_LOT_BUYER'
                          ? 'bg-gold/15 text-gold'
                          : analysis.exit_strategy.recommendation === 'DEVELOPER_FLIP'
                          ? 'bg-purple-400/15 text-purple-400'
                          : analysis.exit_strategy.recommendation === 'HOLD'
                          ? 'bg-white/10 text-white/60'
                          : 'bg-red-400/15 text-red-400'
                      }`}>
                        {analysis.exit_strategy.recommendation.replace(/_/g, ' ')}
                      </span>
                      <p className="text-white/70 text-sm leading-relaxed">{analysis.exit_strategy.reasoning}</p>
                    </div>

                    {/* AI Narrative */}
                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">AI Narrative</p>
                      <p className="text-white text-sm leading-relaxed">{analysis.narrative}</p>
                    </div>

                    {/* Risks */}
                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Risks</p>
                      {analysis.risks.length === 0 ? (
                        <p className="text-white/40 text-sm">No major risks identified.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {analysis.risks.map((r, i) => (
                            <li key={i} className="flex gap-2 text-sm text-white/70">
                              <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      )}
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

                    {/* Disclosures */}
                    <div className="space-y-2 pt-2 border-t border-border-default">
                      <p className="text-white/25 text-[11px] leading-relaxed">
                        ⓘ AriAI can make mistakes. Always verify estimated values and comp data with your own due diligence before making an offer on any land deal.
                      </p>
                      <p className="text-white/25 text-[11px] leading-relaxed">
                        ⓘ Limited sale data is common in land markets. When fewer than 3 comps with actual sale prices are available, treat the estimated value as directional only.
                      </p>
                    </div>

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
                {analysis && (
                  <div className="bg-surface-2 border border-border-default rounded-xl p-4">
                    <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Estimated Value (from analysis)</p>
                    <p className="text-white text-2xl font-bold">{fmt(analysis.estimated_value.estimate)}</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-white/40 text-xs uppercase tracking-wider">Discount</label>
                    <span className="text-gold font-bold text-lg">{discount}%</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={50}
                    step={1}
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="w-full accent-gold"
                  />
                  <div className="flex justify-between text-white/20 text-xs mt-1">
                    <span>30% (lower risk)</span>
                    <span>50% (higher risk / distressed)</span>
                  </div>
                </div>

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
                <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
                  <div className="divide-y divide-border-default">
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <span className="text-white/50 text-sm">Estimated Value</span>
                      <span className="text-white font-semibold text-sm">{fmt(analysis.estimated_value.estimate)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5 pl-8">
                      <span className="text-white/50 text-sm">× Keep % ({100 - discount}%)</span>
                      <span className="text-white font-semibold text-sm">{fmt(analysis.estimated_value.estimate * calcResults.keepPct)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3 bg-surface-2">
                      <span className="text-white font-semibold text-sm">End Buyer Max</span>
                      <span className="text-white font-bold">{fmt(calcResults.endBuyerMax)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5 pl-8">
                      <span className="text-white/50 text-sm">− Wholesale Fee</span>
                      <span className="text-red-400 font-semibold text-sm">−{fmt(wholesaleFee)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-4 bg-gold/10">
                      <span className="text-gold font-bold text-base">Cash Offer</span>
                      <span className="text-gold font-bold text-xl">{fmt(calcResults.cashOffer)}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div>
                        <p className="text-white font-semibold text-sm">Anchor Offer</p>
                        <p className="text-white/30 text-xs mt-0.5">Start here — gives you room to negotiate up to cash offer</p>
                      </div>
                      <span className="text-white font-bold text-lg">{fmt(calcResults.anchorOffer)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-surface-2 border border-border-default rounded-xl p-4">
                  <p className="text-white/50 text-xs leading-relaxed">
                    ⚠ Never pay above end buyer max.
                  </p>
                </div>

                {saveFeedback && (
                  <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
                    saveFeedback.variant === 'success'
                      ? 'bg-green-400/10 text-green-400'
                      : saveFeedback.variant === 'warning'
                      ? 'bg-yellow-400/10 text-yellow-400/80'
                      : 'bg-red-400/10 text-red-400'
                  }`}>
                    {saveFeedback.text}
                  </div>
                )}

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
                    onClick={openSaveModal}
                    disabled={saving}
                    className="bg-gold text-black font-bold py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving…' : 'Add to REIblast'}
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

export default function LandPage() {
  return (
    <Suspense fallback={null}>
      <LandContent />
    </Suspense>
  )
}
