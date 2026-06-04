import { NextRequest, NextResponse } from 'next/server'
import { getSalesComps } from '@/lib/rentcast'
import { prisma } from '@/lib/prisma'

// 1 mile ≈ 0.0145 degrees
const RADIUS_DEG = 0.0145

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

function parseCityStateZip(formattedAddress: string): { city: string; state: string; zip: string } {
  const parts = formattedAddress.split(',').map((s) => s.trim()).filter((s) => s !== 'USA')
  const last = parts[parts.length - 1] ?? ''
  const match = last.match(/([A-Z]{2})\s*(\d{5})?/)
  return {
    city: parts.length >= 2 ? parts[parts.length - 2] : '',
    state: match?.[1] ?? '',
    zip: match?.[2] ?? '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPrice(record: any): number | null {
  if (record.lastSalePrice) return record.lastSalePrice
  if (!record.history) return null
  const sales = Object.values(record.history)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((h: any) => h.price)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sales[0] as any)?.price ?? null
}

function mapDbCompToComp(
  record: {
    id: string
    address: string
    formattedAddress: string
    lat: number | null
    lng: number | null
    beds: number | null
    baths: number | null
    sqft: number | null
    yearBuilt: number | null
    garage: boolean | null
    garageSpaces: number | null
    pool: boolean | null
    lastSalePrice: number | null
    lastSaleDate: Date | null
    source: string
  },
  subjectLat: number,
  subjectLng: number
) {
  const { city, state, zip } = parseCityStateZip(record.formattedAddress)
  const distanceMiles =
    record.lat != null && record.lng != null
      ? haversineMiles(subjectLat, subjectLng, record.lat, record.lng)
      : 0
  const daysAgo = record.lastSaleDate
    ? Math.floor((Date.now() - record.lastSaleDate.getTime()) / 86400000)
    : 0
  const pricePerSqft =
    record.sqft && record.lastSalePrice
      ? Math.round(record.lastSalePrice / record.sqft)
      : null

  return {
    id: record.id,
    address: record.address,
    city,
    state,
    zip,
    beds: record.beds ?? 0,
    baths: record.baths ?? 0,
    sqft: record.sqft ?? 0,
    yearBuilt: record.yearBuilt ?? 0,
    salePrice: record.lastSalePrice ?? 0,
    saleDate: record.lastSaleDate?.toISOString().slice(0, 10) ?? '',
    daysAgo,
    pricePerSqft,
    distanceMiles,
    latitude: record.lat ?? 0,
    longitude: record.lng ?? 0,
    garage: record.garage ?? false,
    garageSpaces: record.garageSpaces ?? 0,
    pool: record.pool ?? false,
  }
}

export async function POST(req: NextRequest) {
  let body: {
    lat?: number
    lng?: number
    formattedAddress?: string
    locationId?: string
    beds?: number
    sqft?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const lat = body.lat
  const lng = body.lng
  const formattedAddress = body.formattedAddress ?? ''
  const locationId = body.locationId ?? ''
  const beds = typeof body.beds === 'number' ? body.beds : 0
  const sqft = typeof body.sqft === 'number' ? body.sqft : 0

  if (lat == null || lng == null) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    // Step 1 — Check PropertyRecord DB for quality comps
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

    const geoWhere = {
      lat: { gte: lat - RADIUS_DEG, lte: lat + RADIUS_DEG },
      lng: { gte: lng - RADIUS_DEG, lte: lng + RADIUS_DEG },
      propertyType: { contains: 'Single Family', mode: 'insensitive' as const },
      lastSalePrice: { gt: 0 },
      lastSaleDate: { gte: oneYearAgo },
      NOT: { formattedAddress },
      ...(sqft > 0 ? { sqft: { gte: sqft - 250, lte: sqft + 750 } } : {}),
      ...(beds > 0 ? { beds: { gte: beds - 1, lte: beds + 1 } } : {}),
    }

    const dbComps = await prisma.propertyRecord.findMany({ where: geoWhere })
    console.log('[comps] DB quality check returned:', dbComps.length, 'comps')

    if (dbComps.length >= 10) {
      console.log('[comps] Sufficient DB comps — skipping Rentcast')
      await prisma.apiCall.create({
        data: {
          locationId,
          resource: 'rentcast',
          endpoint: 'db_cache',
          statusCode: 200,
          resultCount: dbComps.length,
          durationMs: 0,
        },
      }).catch(() => {})

      const mapped = dbComps.map((r) => mapDbCompToComp(r, lat, lng))
      console.log('[comps] Final comp count returned:', mapped.length)
      return NextResponse.json(mapped)
    }

    // Step 2 — Call Rentcast
    console.log('[comps] Insufficient DB comps (' + dbComps.length + ') — calling Rentcast')
    const start = Date.now()
    const rawRecords = await getSalesComps(lat, lng)
    const durationMs = Date.now() - start

    console.log('[comps] Rentcast returned raw count:', rawRecords.length)

    await prisma.apiCall.create({
      data: {
        locationId,
        resource: 'rentcast',
        endpoint: '/v1/properties',
        statusCode: 200,
        resultCount: rawRecords.length,
        durationMs,
      },
    }).catch(() => {})

    if (rawRecords.length === 0) {
      return NextResponse.json([])
    }

    // Step 3 — Upsert each Rentcast record into PropertyRecord
    let storedCount = 0
    await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rawRecords as any[]).map(async (record) => {
        if (!record.formattedAddress) return
        if (record.formattedAddress === formattedAddress) return

        const price = extractPrice(record)

        try {
          await prisma.propertyRecord.upsert({
            where: { formattedAddress: record.formattedAddress },
            create: {
              address: (record.addressLine1 || record.formattedAddress.split(',')[0]).trim(),
              formattedAddress: record.formattedAddress,
              lat: record.latitude ?? null,
              lng: record.longitude ?? null,
              propertyType: record.propertyType ?? null,
              beds: record.bedrooms ?? null,
              baths: record.bathrooms ?? null,
              sqft: record.squareFootage ?? null,
              lotSizeSqft: record.lotSize ?? null,
              yearBuilt: record.yearBuilt ?? null,
              zoning: record.zoning ?? null,
              subdivision: record.subdivision ?? null,
              garage: record.features?.garage ?? null,
              garageSpaces: record.features?.garageSpaces ?? null,
              pool: record.features?.pool ?? null,
              lastSalePrice: price != null ? Math.round(price) : null,
              lastSaleDate: record.lastSaleDate ? new Date(record.lastSaleDate) : null,
              source: 'rentcast',
              lastVerified: new Date(),
            },
            update: {
              lastSalePrice: price != null ? Math.round(price) : null,
              lastSaleDate: record.lastSaleDate ? new Date(record.lastSaleDate) : null,
              lastVerified: new Date(),
            },
          })
          storedCount++
        } catch {
          // non-fatal
        }
      })
    )
    console.log('[comps] Stored', storedCount, 'records in PropertyRecord')

    // Step 4 — Filter and return (only exclude the subject property itself)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filteredComps = (rawRecords as any[])
      .filter((r) => {
        if (!r.formattedAddress) return false
        if (r.formattedAddress === formattedAddress) return false
        return true
      })
      .map((r) => {
        const { city, state, zip } = parseCityStateZip(r.formattedAddress)
        const price = extractPrice(r) as number | null
        const sqftVal = r.squareFootage as number
        const compLat = r.latitude as number
        const compLng = r.longitude as number
        const saleDate = r.lastSaleDate ? new Date(r.lastSaleDate) : null
        return {
          id: (r.id as string) || `${r.formattedAddress}-${r.lastSaleDate}`,
          address: (r.addressLine1 || r.formattedAddress.split(',')[0]).trim(),
          city,
          state,
          zip,
          beds: r.bedrooms ?? 0,
          baths: r.bathrooms ?? 0,
          sqft: sqftVal ?? 0,
          yearBuilt: r.yearBuilt ?? 0,
          salePrice: price ?? 0,
          saleDate: r.lastSaleDate ?? '',
          daysAgo: saleDate ? Math.floor((Date.now() - saleDate.getTime()) / 86400000) : 0,
          pricePerSqft: sqftVal && price ? Math.round(price / sqftVal) : null,
          distanceMiles: compLat != null && compLng != null ? haversineMiles(lat, lng, compLat, compLng) : 0,
          latitude: compLat ?? 0,
          longitude: compLng ?? 0,
          garage: r.features?.garage ?? false,
          garageSpaces: r.features?.garageSpaces ?? 0,
          pool: r.features?.pool ?? false,
        }
      })

    console.log('[comps] Returning comp count:', filteredComps.length)
    const withPrice = filteredComps.filter((c) => c.salePrice).length
    console.log('[comps] Comps with sale price:', withPrice, 'of', filteredComps.length)
    return NextResponse.json(filteredComps)
  } catch (err) {
    console.error('[analyzer/comps] error:', err)
    return NextResponse.json({ error: 'Failed to fetch comps' }, { status: 500 })
  }
}
