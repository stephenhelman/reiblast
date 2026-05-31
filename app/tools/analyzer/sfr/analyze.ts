export interface AdjustmentPill {
  label: string
  amount: number
}

export interface SFRAnalysisPayload {
  subject: {
    address: string
    beds: number | ''
    baths: number | ''
    sqft: number | ''
    parking: string
    garageSpaces: number
    features: string[]
    condition: string
  }
  comps: Array<{
    address: string
    salePrice: number
    adjustedPrice: number
    adjustments: AdjustmentPill[]
    beds: number
    baths: number
    sqft: number
    distanceMiles: number
    daysSinceSold: number
    pricePerSqft: number | null
  }>
}

export interface SFRAnalysisResult {
  comps: Array<{
    address: string
    sale_price: number
    adjusted_price: number
    type: 'RENOVATED' | 'AS_IS'
    type_reasoning: string
    weight: 'high' | 'medium' | 'low'
  }>
  arv: {
    estimate: number
    low: number
    high: number
    confidence: 'high' | 'medium' | 'low'
    confidence_reason: string
  }
  as_is: {
    value: number | null
    low: number | null
    high: number | null
    note: string
  }
  exit_strategy: {
    recommendation: 'WHOLESALE' | 'FIX_AND_FLIP' | 'SUBJECT_TO' | 'PASS'
    reasoning: string
  }
  narrative: string
  warnings: string[]
}

export interface LandAnalysisPayload {
  address: string
}

export interface LandAnalysisResult {
  stubbed: true
  message: string
}

export async function analyzeSFR(payload: SFRAnalysisPayload): Promise<SFRAnalysisResult> {
  const res = await fetch('/api/analyzer/arv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: payload.subject, comps: payload.comps }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || 'Analysis failed')
  }
  return res.json()
}

export async function analyzeLand(_payload: LandAnalysisPayload): Promise<LandAnalysisResult> {
  return { stubbed: true, message: 'Land analysis coming soon' }
}
