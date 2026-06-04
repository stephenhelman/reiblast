import { NextRequest, NextResponse } from 'next/server'
import { lookupProperty } from '@/lib/melissa'
import { prisma } from '@/lib/prisma'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  let body: { formattedAddress?: string; locationId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { formattedAddress = '', locationId = '' } = body

  if (!formattedAddress) {
    return NextResponse.json({ error: 'formattedAddress is required' }, { status: 400 })
  }

  try {
    // Step 1 — Check DB first
    console.log('[property] Checking DB for:', formattedAddress)
    const existing = await prisma.propertyRecord.findUnique({
      where: { formattedAddress },
    })

    const isRecent =
      existing &&
      Date.now() - existing.lastVerified.getTime() < NINETY_DAYS_MS

    if (isRecent) {
      console.log('[property] DB hit — returning cached record')
      await prisma.apiCall.create({
        data: {
          locationId,
          resource: 'melissa',
          endpoint: 'db_cache',
          statusCode: 200,
          resultCount: 1,
          durationMs: 0,
        },
      }).catch(() => {})
      return NextResponse.json({ found: true, ...serializeRecord(existing) })
    }

    // Step 2 — Call Melissa
    console.log('[property] DB miss — calling Melissa')
    let melissaRecord: Awaited<ReturnType<typeof lookupProperty>>['record'] = null
    let statusCode = 500
    let durationMs = 0

    try {
      const result = await lookupProperty(formattedAddress)
      melissaRecord = result.record
      statusCode = result.statusCode
      durationMs = result.durationMs
    } catch (err) {
      console.error('[property] Melissa error:', err)
    }

    await prisma.apiCall.create({
      data: {
        locationId,
        resource: 'melissa',
        endpoint: '/LookupProperty',
        statusCode,
        resultCount: melissaRecord ? 1 : 0,
        durationMs,
      },
    }).catch(() => {})

    if (!melissaRecord) {
      console.log('[property] Melissa returned no data')
      return NextResponse.json({ found: false })
    }

    console.log('[property] Melissa returned data for:', formattedAddress)

    // Step 3 — Upsert into PropertyRecord
    try {
      await prisma.propertyRecord.upsert({
        where: { formattedAddress },
        create: {
          address: formattedAddress.split(',')[0].trim(),
          formattedAddress,
          source: 'melissa',
          ...melissaRecord,
        },
        update: {
          source: 'melissa',
          lastVerified: new Date(),
          ...melissaRecord,
        },
      })
      console.log('[property] Stored in PropertyRecord')
    } catch (err) {
      console.error('[property] DB upsert failed (non-fatal):', err)
    }

    // Step 4 — Return
    return NextResponse.json({ found: true, ...melissaRecord })
  } catch (err) {
    console.error('[property] Unexpected error:', err)
    return NextResponse.json({ found: false })
  }
}

// Serialize dates to strings for JSON response
function serializeRecord(r: {
  beds: number | null
  baths: number | null
  sqft: number | null
  lotSizeSqft: number | null
  lotSizeAcres: number | null
  yearBuilt: number | null
  propertyType: string | null
  garage: boolean | null
  garageSpaces: number | null
  carport: boolean | null
  pool: boolean | null
  ownerName: string | null
  ownerOccupied: boolean | null
  ownerType: string | null
  mortgageAmount: number | null
  assessedValue: number | null
  taxDelinquentYear: string | null
  estimatedValue: number | null
  estimatedValueMin: number | null
  estimatedValueMax: number | null
  lastSaleDate: Date | null
  lastSalePrice: number | null
}) {
  return {
    ...r,
    lastSaleDate: r.lastSaleDate?.toISOString() ?? null,
  }
}
