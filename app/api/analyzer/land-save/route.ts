import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getGhlAccessToken } from '@/lib/ghl-token'
import { TOOLS_URL } from '@/lib/constants'

const GHL_BASE = 'https://services.leadconnectorhq.com'

interface LandSaveBody {
  locationId: string
  address: string
  lat?: number | null
  lng?: number | null
  lotSizeSqft?: number | null
  lotSizeAcres?: number | null
  zoning?: string | null
  roadAccess?: string | null
  utilities?: string[]
  topography?: string | null
  estimatedValue: number
  estimatedValueLow?: number | null
  estimatedValueHigh?: number | null
  valueConfidence?: string | null
  valueMethod?: string | null
  builderActivityLevel?: string | null
  builderActivityNote?: string | null
  exitStrategy?: string | null
  narrative?: string | null
  risks?: string[]
  warnings?: string[]
  discount: number
  endBuyerMax: number
  wholesaleFee: number
  cashOffer: number
  anchorOffer: number
  compsJson?: string | null
  compsRawJson?: string | null
  contactId?: string | null
  skipGhl?: boolean
}

export async function POST(req: NextRequest) {
  let body: Partial<LandSaveBody>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const required: (keyof LandSaveBody)[] = [
    'locationId', 'address', 'estimatedValue', 'discount',
    'endBuyerMax', 'wholesaleFee', 'cashOffer', 'anchorOffer',
  ]
  for (const key of required) {
    if (body[key] == null) {
      return NextResponse.json({ error: `Missing field: ${key}` }, { status: 400 })
    }
  }

  const {
    locationId, address, lat, lng,
    lotSizeSqft, lotSizeAcres, zoning, roadAccess,
    utilities, topography,
    estimatedValue, estimatedValueLow, estimatedValueHigh,
    valueConfidence, valueMethod,
    builderActivityLevel, builderActivityNote,
    exitStrategy, narrative, risks, warnings,
    discount, endBuyerMax, wholesaleFee, cashOffer, anchorOffer,
    compsJson, compsRawJson,
    contactId, skipGhl,
  } = body as LandSaveBody

  let deal: { id: string }
  try {
    deal = await prisma.landDeal.upsert({
      where: { locationId_address: { locationId, address } },
      create: {
        locationId,
        address,
        lat: lat ?? null,
        lng: lng ?? null,
        lotSizeSqft: lotSizeSqft ?? null,
        lotSizeAcres: lotSizeAcres ?? null,
        zoning: zoning ?? null,
        roadAccess: roadAccess ?? null,
        utilities: utilities ?? [],
        topography: topography ?? null,
        estimatedValue,
        estimatedValueLow: estimatedValueLow ?? null,
        estimatedValueHigh: estimatedValueHigh ?? null,
        valueConfidence: valueConfidence ?? null,
        valueMethod: valueMethod ?? null,
        builderActivityLevel: builderActivityLevel ?? null,
        builderActivityNote: builderActivityNote ?? null,
        exitStrategy: exitStrategy ?? null,
        narrative: narrative ?? null,
        risks: risks ?? [],
        warnings: warnings ?? [],
        discount,
        endBuyerMax,
        wholesaleFee,
        cashOffer,
        anchorOffer,
        compsJson: compsJson ?? null,
        compsRawJson: compsRawJson ?? null,
        dealUrl: '',
        dealType: 'land',
      },
      update: {
        lat: lat ?? null,
        lng: lng ?? null,
        lotSizeSqft: lotSizeSqft ?? null,
        lotSizeAcres: lotSizeAcres ?? null,
        zoning: zoning ?? null,
        roadAccess: roadAccess ?? null,
        utilities: utilities ?? [],
        topography: topography ?? null,
        estimatedValue,
        estimatedValueLow: estimatedValueLow ?? null,
        estimatedValueHigh: estimatedValueHigh ?? null,
        valueConfidence: valueConfidence ?? null,
        valueMethod: valueMethod ?? null,
        builderActivityLevel: builderActivityLevel ?? null,
        builderActivityNote: builderActivityNote ?? null,
        exitStrategy: exitStrategy ?? null,
        narrative: narrative ?? null,
        risks: risks ?? [],
        warnings: warnings ?? [],
        discount,
        endBuyerMax,
        wholesaleFee,
        cashOffer,
        anchorOffer,
        compsJson: compsJson ?? null,
        compsRawJson: compsRawJson ?? null,
      },
      select: { id: true },
    })

    const dealUrl = `${TOOLS_URL}/tools/analyzer/deals/land/${deal.id}`
    await prisma.landDeal.update({ where: { id: deal.id }, data: { dealUrl } })

    if (skipGhl) {
      return NextResponse.json({ success: true, dealUrl, ghlSynced: false, ghlError: null })
    }

    let ghlSynced = false
    let ghlError: string | null = null

    try {
      const accessToken = await getGhlAccessToken(locationId)
      const keepPct = 1 - (discount / 100)

      const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Chicago',
      })

      const customFields = [
        { key: 'analysis_url',              field_value: dealUrl },
        { key: 'analysis_arv',              field_value: estimatedValue.toString() },
        { key: 'analysis_ebm',              field_value: endBuyerMax.toString() },
        { key: 'analysis_repair_level',     field_value: `${discount}% discount` },
        { key: 'analysis_repairs',          field_value: '0' },
        { key: 'analysis_wholesale_fee',    field_value: wholesaleFee.toString() },
        { key: 'analysis_mao',              field_value: cashOffer.toString() },
        { key: 'analysis_anchor',           field_value: anchorOffer.toString() },
        { key: 'analysis_investor_percent', field_value: (keepPct * 100).toFixed(0) },
        { key: 'analysis_last_updated',     field_value: timestamp },
      ]

      if (contactId) {
        const ghlRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ customFields }),
        })
        if (!ghlRes.ok) {
          ghlError = await ghlRes.text()
        } else {
          ghlSynced = true
        }
      } else {
        const ghlRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ locationId, name: address, address1: address, customFields }),
        })
        if (!ghlRes.ok) {
          ghlError = await ghlRes.text()
        } else {
          ghlSynced = true
        }
      }
    } catch (err) {
      ghlError = err instanceof Error ? err.message : String(err)
    }

    return NextResponse.json({ success: true, dealUrl, ghlSynced, ghlError })
  } catch (err) {
    console.error('[land-save] Neon error:', err)
    return NextResponse.json({ error: 'Failed to save land deal' }, { status: 500 })
  }
}
