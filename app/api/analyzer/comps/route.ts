import { NextRequest, NextResponse } from 'next/server'
import { getSalesComps } from '@/lib/rentcast'

export async function POST(req: NextRequest) {
  let body: {
    address?: string
    latitude?: number
    longitude?: number
    beds?: number
    baths?: number
    radius?: number
    months?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.address || body.latitude == null || body.longitude == null || body.beds == null || body.baths == null) {
    return NextResponse.json({ error: 'address, latitude, longitude, beds, and baths are required' }, { status: 400 })
  }

  const radius = body.radius ?? 0.5
  const months = body.months ?? 6

  try {
    const data = await getSalesComps(body.address, body.latitude, body.longitude, radius, months)
    const comps: unknown[] = data?.comparables || data || []

    const now = Date.now()

    const filtered = comps
      .filter((c: unknown) => {
        const comp = c as Record<string, unknown>
        const compBeds = comp.bedrooms as number
        const compBaths = comp.bathrooms as number
        return (
          compBeds != null && Math.abs(compBeds - body.beds!) <= 1 &&
          compBaths != null && Math.abs(compBaths - body.baths!) <= 1
        )
      })
      .sort((a: unknown, b: unknown) => {
        const ca = a as Record<string, unknown>
        const cb = b as Record<string, unknown>
        return new Date(cb.saleDate as string).getTime() - new Date(ca.saleDate as string).getTime()
      })
      .map((c: unknown) => {
        const comp = c as Record<string, unknown>
        const saleDate = new Date(comp.saleDate as string)
        const daysAgo = Math.round((now - saleDate.getTime()) / 86400000)
        const sqft = comp.squareFootage as number
        const price = comp.price as number
        const pricePerSqft = sqft && price ? Math.round(price / sqft) : null
        return {
          id: comp.id || `${comp.formattedAddress}-${comp.saleDate}`,
          address: comp.formattedAddress,
          city: comp.city,
          state: comp.state,
          zip: comp.zipCode,
          beds: comp.bedrooms,
          baths: comp.bathrooms,
          sqft,
          yearBuilt: comp.yearBuilt,
          salePrice: price,
          saleDate: comp.saleDate,
          daysAgo,
          pricePerSqft,
          distance: comp.distance,
          latitude: comp.latitude,
          longitude: comp.longitude,
        }
      })

    return NextResponse.json(filtered)
  } catch (err) {
    console.error('[analyzer/comps] error:', err)
    return NextResponse.json({ error: 'Failed to fetch comps' }, { status: 500 })
  }
}
