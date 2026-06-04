import { NextRequest, NextResponse } from 'next/server'
import { getSalesComps } from '@/lib/rentcast'
import { prisma } from '@/lib/prisma'

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 100) / 100
}

function hasHistoryPrice(rec: Record<string, unknown>): boolean {
  const history = rec.history
  if (!history || typeof history !== 'object') return false
  return Object.values(history as Record<string, unknown>).some((entry) => {
    const e = entry as Record<string, unknown>
    return e != null && typeof e === 'object' && (e.price as number) > 0
  })
}

function filterAndMap(
  raw: unknown[],
  lat: number,
  lng: number
): ReturnType<typeof mapComp>[] {
  const now = Date.now()
  const filtered = raw.filter((r) => {
    const rec = r as Record<string, unknown>
    const price = rec.lastSalePrice as number | null | undefined
    const noPrice = price == null || price === 0
    return !(noPrice && !hasHistoryPrice(rec))
  })
  console.log('[comps] After null-price filter:', filtered.length)
  return filtered.map((r) => mapComp(r, lat, lng, now))
}

function mapComp(r: unknown, lat: number, lng: number, now: number) {
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
    distanceMiles: haversineMiles(lat, lng, compLat, compLng),
    garage: (features?.garage as boolean) ?? false,
    garageSpaces: (features?.garageSpaces as number) ?? 0,
    pool: (features?.pool as boolean) ?? false,
  }
}

export async function POST(req: NextRequest) {
  let body: { lat?: number; lng?: number; formattedAddress?: string; locationId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { lat, lng, formattedAddress = '', locationId = '' } = body

  if (lat == null || lng == null) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    // Check DB cache
    const cached = await prisma.rentcastPull.findFirst({
      where: {
        lat: { gte: lat - 0.005, lte: lat + 0.005 },
        lng: { gte: lng - 0.005, lte: lng + 0.005 },
        resultCount: { gt: 0 },
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (cached) {
      console.log('[comps] Cache hit — id:', cached.id, 'pulled on:', cached.createdAt)
      const rawRecords = JSON.parse(cached.rawJson) as unknown[]
      console.log('[comps] Rentcast returned raw count:', rawRecords.length)
      const mappedComps = filterAndMap(rawRecords, lat, lng)
      return NextResponse.json(mappedComps)
    }

    // Call Rentcast
    const rawRecords = await getSalesComps(lat, lng)
    console.log('[comps] Rentcast returned raw count:', rawRecords.length)

    if (rawRecords.length === 0) {
      return NextResponse.json([])
    }

    const mappedComps = filterAndMap(rawRecords, lat, lng)

    // Store in DB (non-blocking)
    try {
      await prisma.rentcastPull.create({
        data: {
          locationId,
          address: formattedAddress,
          lat,
          lng,
          radius: 1,
          resultCount: mappedComps.length,
          rawJson: JSON.stringify(rawRecords),
        },
      })
    } catch (dbErr) {
      console.error('[comps] DB write failed (non-fatal):', dbErr)
    }

    return NextResponse.json(mappedComps)
  } catch (err) {
    console.error('[analyzer/comps] error:', err)
    return NextResponse.json({ error: 'Failed to fetch comps' }, { status: 500 })
  }
}
