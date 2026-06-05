import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 0.072 degrees ≈ 5 miles
const RADIUS_DEG = 0.072

type PriceSource = 'sale' | 'history' | 'assessment' | 'none'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPriceFromHistory(history: Record<string, any> | null | undefined): number | null {
  if (!history) return null
  const sales = Object.values(history)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((h: any) => h.price && h.price > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sales[0] as any)?.price ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMostRecentLandAssessment(taxAssessments: Record<string, any> | null | undefined): number | null {
  if (!taxAssessments) return null
  const years = Object.keys(taxAssessments).sort().reverse()
  for (const year of years) {
    if (taxAssessments[year]?.land) return taxAssessments[year].land
  }
  return null
}

export async function POST(req: NextRequest) {
  let body: {
    lat?: number
    lng?: number
    lotSizeSqft?: number
    locationId?: string
    formattedAddress?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const lat = body.lat
  const lng = body.lng
  const lotSizeSqft = typeof body.lotSizeSqft === 'number' ? body.lotSizeSqft : 0
  const locationId = body.locationId ?? ''
  const formattedAddress = body.formattedAddress ?? ''

  if (lat == null || lng == null) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    // Step 1 — DB-first: check PropertyRecord for land comps
    const dbComps = await prisma.propertyRecord.findMany({
      where: {
        lat: { gte: lat - RADIUS_DEG, lte: lat + RADIUS_DEG },
        lng: { gte: lng - RADIUS_DEG, lte: lng + RADIUS_DEG },
        propertyType: { contains: 'Land', mode: 'insensitive' },
        OR: [
          { lastSalePrice: { gt: 0 } },
          { assessedValue: { gt: 0 } },
        ],
        NOT: { formattedAddress },
      },
    })

    console.log('[land-comps] DB check returned:', dbComps.length, 'comps')

    if (dbComps.length >= 10) {
      console.log('[land-comps] Sufficient DB comps — skipping Rentcast')
      await prisma.apiCall.create({
        data: {
          locationId,
          resource: 'rentcast',
          endpoint: 'db_cache_land',
          statusCode: 200,
          resultCount: dbComps.length,
          durationMs: 0,
        },
      }).catch(() => {})

      const mapped = dbComps.map((r) => mapDbRecordToLandComp(r, lat, lng))
      return NextResponse.json(mapped)
    }

    // Step 2 — Call Rentcast
    console.log('[land-comps] Insufficient DB comps (' + dbComps.length + ') — calling Rentcast')
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      radius: '5',
      propertyType: 'Land',
      limit: '500',
    })
    const url = `https://api.rentcast.io/v1/properties?${params}`
    const start = Date.now()
    const res = await fetch(url, {
      headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY! },
      next: { revalidate: 0 },
    })
    const durationMs = Date.now() - start

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] = []
    if (res.ok) {
      data = await res.json()
    }
    console.log('[land-comps] Rentcast returned:', data.length, 'records')

    await prisma.apiCall.create({
      data: {
        locationId,
        resource: 'rentcast',
        endpoint: '/v1/properties/land',
        statusCode: res.status,
        resultCount: data.length,
        durationMs,
      },
    }).catch(() => {})

    // Step 3 — Upsert into PropertyRecord
    let storedCount = 0
    await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any[]).map(async (record) => {
        if (!record.formattedAddress) return
        if (record.formattedAddress === formattedAddress) return

        const { salePrice, priceSource } = computePriceAndSource(record)

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
              zoning: record.zoning ?? null,
              subdivision: record.subdivision ?? null,
              lastSalePrice: salePrice != null ? Math.round(salePrice) : null,
              lastSaleDate: record.lastSaleDate ? new Date(record.lastSaleDate) : null,
              priceSource,
              source: 'rentcast',
              lastVerified: new Date(),
            },
            update: {
              lastSalePrice: salePrice != null ? Math.round(salePrice) : null,
              lastSaleDate: record.lastSaleDate ? new Date(record.lastSaleDate) : null,
              priceSource,
              lastVerified: new Date(),
            },
          })
          storedCount++
        } catch {
          // non-fatal
        }
      })
    )
    console.log('[land-comps] Stored', storedCount, 'land records')

    // Step 4 — Map and filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (data as any[])
      .filter((r) => {
        if (!r.formattedAddress) return false
        if (r.formattedAddress === formattedAddress) return false
        const { salePrice } = computePriceAndSource(r)
        const landAssessment = getMostRecentLandAssessment(r.taxAssessments)
        return salePrice != null || landAssessment != null
      })
      .map((r) => {
        const { salePrice, priceSource } = computePriceAndSource(r)
        const taxAssessedLandValue = getMostRecentLandAssessment(r.taxAssessments)
        const compLat = r.latitude as number
        const compLng = r.longitude as number
        const lotSize = r.lotSize as number | null | undefined

        return {
          id: (r.id as string) || `${r.formattedAddress}-${r.lastSaleDate ?? 'nodate'}`,
          address: r.formattedAddress,
          lat: compLat ?? null,
          lng: compLng ?? null,
          lotSizeSqft: lotSize ?? null,
          lotSizeAcres: lotSize ? parseFloat((lotSize / 43560).toFixed(3)) : null,
          zoning: r.zoning ?? null,
          lastSalePrice: salePrice ?? null,
          lastSaleDate: r.lastSaleDate ?? null,
          taxAssessedLandValue,
          hasStructure: r.squareFootage ? true : false,
          ownerType: r.owner?.type ?? null,
          subdivision: r.subdivision ?? null,
          source: 'rentcast' as const,
          priceSource,
          pricePerSqft: salePrice && lotSize ? parseFloat((salePrice / lotSize).toFixed(2)) : null,
          pricePerAcre: salePrice && lotSize ? Math.round(salePrice / (lotSize / 43560)) : null,
          daysSinceSold: r.lastSaleDate
            ? Math.floor((Date.now() - new Date(r.lastSaleDate).getTime()) / 86400000)
            : null,
          distanceMiles:
            compLat != null && compLng != null
              ? haversineMiles(lat, lng, compLat, compLng)
              : 0,
        }
      })

    console.log('[land-comps] Returning', results.length, 'land comps')
    return NextResponse.json(results)
  } catch (err) {
    console.error('[land-comps] error:', err)
    return NextResponse.json({ error: 'Failed to fetch land comps' }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computePriceAndSource(record: any): { salePrice: number | null; priceSource: PriceSource } {
  if (record.lastSalePrice && record.lastSalePrice > 0) {
    return { salePrice: record.lastSalePrice, priceSource: 'sale' }
  }
  const historyPrice = extractPriceFromHistory(record.history)
  if (historyPrice) {
    return { salePrice: historyPrice, priceSource: 'history' }
  }
  const landAssessment = getMostRecentLandAssessment(record.taxAssessments)
  if (landAssessment) {
    return { salePrice: landAssessment, priceSource: 'assessment' }
  }
  return { salePrice: null, priceSource: 'none' }
}

function mapDbRecordToLandComp(
  record: {
    id: string
    formattedAddress: string
    lat: number | null
    lng: number | null
    lotSizeSqft: number | null
    zoning: string | null
    lastSalePrice: number | null
    lastSaleDate: Date | null
    priceSource: string | null
    sqft: number | null
    ownerType: string | null
    subdivision: string | null
    source: string
    assessedValue: number | null
  },
  subjectLat: number,
  subjectLng: number
) {
  const salePrice = record.lastSalePrice
  const priceSource = (record.priceSource ?? 'sale') as PriceSource
  const lotSize = record.lotSizeSqft

  return {
    id: record.id,
    address: record.formattedAddress,
    lat: record.lat,
    lng: record.lng,
    lotSizeSqft: lotSize ?? null,
    lotSizeAcres: lotSize ? parseFloat((lotSize / 43560).toFixed(3)) : null,
    zoning: record.zoning ?? null,
    lastSalePrice: salePrice ?? null,
    lastSaleDate: record.lastSaleDate?.toISOString().slice(0, 10) ?? null,
    taxAssessedLandValue: record.assessedValue ?? null,
    hasStructure: record.sqft ? true : false,
    ownerType: record.ownerType ?? null,
    subdivision: record.subdivision ?? null,
    source: 'rentcast' as const,
    priceSource,
    pricePerSqft: salePrice && lotSize ? parseFloat((salePrice / lotSize).toFixed(2)) : null,
    pricePerAcre: salePrice && lotSize ? Math.round(salePrice / (lotSize / 43560)) : null,
    daysSinceSold: record.lastSaleDate
      ? Math.floor((Date.now() - record.lastSaleDate.getTime()) / 86400000)
      : null,
    distanceMiles:
      record.lat != null && record.lng != null
        ? haversineMiles(subjectLat, subjectLng, record.lat, record.lng)
        : 0,
  }
}
