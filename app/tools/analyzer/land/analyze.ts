export interface LandAnalysisPayload {
  subject: {
    address: string
    lat: number
    lng: number
    lotSizeSqft: number
    lotSizeAcres: number
    zoning: string | null
    roadAccess: string | null
    utilities: string[]
    topography: string | null
    notes: string | null
  }
  comps: LandComp[]
  contextParcels: LandComp[]
  locationId?: string
}

export interface LandAnalysisResult {
  comps: Array<{
    address: string
    classification: 'VACANT_LAND' | 'TEARDOWN' | 'UNKNOWN'
    classification_reasoning: string
    weight: 'high' | 'medium' | 'low'
    lotSizeAcres: number | null
    lastSalePrice: number | null
    taxAssessedLandValue: number | null
    pricePerSqft: number | null
    daysSinceSold: number | null
    priceSource: 'sale' | 'history' | 'assessment' | 'none'
    source: 'rentcast' | 'manual'
  }>
  estimated_value: {
    estimate: number
    low: number
    high: number
    confidence: 'high' | 'medium' | 'low'
    confidence_reason: string
    value_method: 'comps' | 'tax_assessment' | 'hybrid'
  }
  builder_activity: {
    level: 'high' | 'moderate' | 'low' | 'unknown'
    note: string
  }
  exit_strategy: {
    recommendation: 'BUILDER_SALE' | 'RETAIL_LOT_BUYER' | 'DEVELOPER_FLIP' | 'HOLD' | 'PASS'
    reasoning: string
  }
  narrative: string
  risks: string[]
  warnings: string[]
}

export interface LandComp {
  id: string
  address: string
  lat: number | null
  lng: number | null
  lotSizeSqft: number | null
  lotSizeAcres: number | null
  zoning: string | null
  lastSalePrice: number | null
  lastSaleDate: string | null
  taxAssessedLandValue: number | null
  hasStructure: boolean
  ownerType: string | null
  subdivision: string | null
  source: 'rentcast' | 'manual'
  priceSource: 'sale' | 'history' | 'assessment' | 'none'
  pricePerSqft: number | null
  pricePerAcre: number | null
  daysSinceSold: number | null
  distanceMiles: number
}

export async function analyzeLand(payload: LandAnalysisPayload): Promise<LandAnalysisResult> {
  const res = await fetch('/api/analyzer/land', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Land analysis failed. Try again.')
  }
  return res.json() as Promise<LandAnalysisResult>
}
