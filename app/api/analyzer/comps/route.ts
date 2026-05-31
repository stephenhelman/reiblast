import { NextRequest, NextResponse } from 'next/server'
import { getSalesComps } from '@/lib/rentcast'

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8 // Earth radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 100) / 100
}

export async function POST(req: NextRequest) {
  let body: { lat?: number; lng?: number; beds?: number; baths?: number; sqft?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.lat == null || body.lng == null || body.beds == null || body.sqft == null) {
    return NextResponse.json(
      { error: 'lat, lng, beds, and sqft are required' },
      { status: 400 }
    )
  }

  try {
    const data = await getSalesComps(body.lat, body.lng, body.beds, body.sqft)
    const records: unknown[] = Array.isArray(data) ? data : []
    const now = Date.now()

    const mapped = records
      .filter((r: unknown) => {
        const rec = r as Record<string, unknown>
        const price = rec.lastSalePrice as number | null | undefined
        return price != null && price > 0
      })
      .map((r: unknown) => {
        const rec = r as Record<string, unknown>
        const features = rec.features as Record<string, unknown> | null | undefined
        const saleDate = rec.lastSaleDate ? new Date(rec.lastSaleDate as string) : null
        const daysAgo = saleDate ? Math.round((now - saleDate.getTime()) / 86400000) : 0
        const sqft = rec.squareFootage as number
        const price = rec.lastSalePrice as number
        const pricePerSqft = sqft && price ? Math.round(price / sqft) : null
        const compLat = rec.latitude as number
        const compLng = rec.longitude as number
        return {
          id: (rec.id as string) || `${rec.formattedAddress}-${rec.lastSaleDate}`,
          address: rec.formattedAddress as string,
          city: rec.city as string,
          state: rec.state as string,
          zip: rec.zipCode as string,
          beds: rec.bedrooms as number,
          baths: rec.bathrooms as number,
          sqft,
          yearBuilt: rec.yearBuilt as number,
          salePrice: price,
          saleDate: rec.lastSaleDate as string,
          daysAgo,
          pricePerSqft,
          latitude: compLat,
          longitude: compLng,
          distanceMiles: haversineMiles(body.lat!, body.lng!, compLat, compLng),
          garage: (features?.garage as boolean) ?? false,
          garageSpaces: (features?.garageSpaces as number) ?? 0,
          pool: (features?.pool as boolean) ?? false,
        }
      })

    return NextResponse.json(mapped)
  } catch (err) {
    console.error('[analyzer/comps] error:', err)
    return NextResponse.json({ error: 'Failed to fetch comps' }, { status: 500 })
  }
}
