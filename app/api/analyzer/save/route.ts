import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getGhlAccessToken } from '@/lib/ghl-token'
import { TOOLS_URL } from '@/lib/constants'

const GHL_BASE = 'https://services.leadconnectorhq.com'

interface SaveBody {
  locationId: string
  address: string
  arv: number
  endBuyerMax: number
  repairLevel: string
  repairs: number
  wholesaleFee: number
  mao: number
  anchorOffer: number
  investorPct: number
  narrative: string
  compsUsed: number
}

export async function POST(req: NextRequest) {
  let body: Partial<SaveBody>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('[analyzer/save] Save route called. Body:', JSON.stringify(body))

  const required: (keyof SaveBody)[] = [
    'locationId', 'address', 'arv', 'endBuyerMax', 'repairLevel',
    'repairs', 'wholesaleFee', 'mao', 'anchorOffer', 'investorPct',
    'narrative', 'compsUsed',
  ]
  for (const key of required) {
    if (body[key] == null) {
      return NextResponse.json({ error: `Missing field: ${key}` }, { status: 400 })
    }
  }

  const {
    locationId, address, arv, endBuyerMax, repairLevel, repairs,
    wholesaleFee, mao, anchorOffer, investorPct, narrative, compsUsed,
  } = body as SaveBody

  let deal: { id: string }
  try {
    console.log('[analyzer/save] Writing to Neon. address:', address, '| locationId:', locationId)

    deal = await prisma.deal.upsert({
      where: { locationId_address: { locationId, address } },
      create: {
        locationId, address, arv, endBuyerMax, repairLevel, repairs,
        wholesaleFee, mao, anchorOffer, investorPct, narrative, compsUsed,
        dealUrl: '',
      },
      update: {
        arv, endBuyerMax, repairLevel, repairs,
        wholesaleFee, mao, anchorOffer, investorPct, narrative, compsUsed,
      },
      select: { id: true },
    })

    const dealUrl = `${TOOLS_URL}/analyzer/deals/${deal.id}`
    await prisma.deal.update({ where: { id: deal.id }, data: { dealUrl } })

    console.log('[analyzer/save] Neon write result. deal.id:', deal.id, '| dealUrl:', dealUrl)

    // ── GHL sync ──────────────────────────────────────────────────────────────

    console.log('[analyzer/save] Attempting GHL sync for locationId', locationId)

    let ghlSynced = false
    let ghlError: string | null = null

    try {
      const accessToken = await getGhlAccessToken(locationId)

      const customFields = [
        { key: 'analysis_url',              field_value: dealUrl },
        { key: 'analysis_arv',              field_value: arv.toString() },
        { key: 'analysis_ebm',              field_value: endBuyerMax.toString() },
        { key: 'analysis_repair_level',     field_value: repairLevel },
        { key: 'analysis_repairs',          field_value: repairs.toString() },
        { key: 'analysis_wholesale_fee',    field_value: wholesaleFee.toString() },
        { key: 'analysis_mao',              field_value: mao.toString() },
        { key: 'analysis_anchor',           field_value: anchorOffer.toString() },
        { key: 'analysis_investor_percent', field_value: investorPct.toString() },
      ]

      const ghlRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locationId, name: address, address1: address, customFields }),
      })

      console.log('[analyzer/save] GHL upsert response status:', ghlRes.status)

      if (!ghlRes.ok) {
        const errBody = await ghlRes.text()
        console.error('[analyzer/save] GHL upsert failed:', errBody)
        ghlError = errBody
      } else {
        const ghlData = await ghlRes.json()
        console.log('[analyzer/save] GHL upsert success. contact id:', ghlData?.contact?.id ?? ghlData?.id)
        ghlSynced = true
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[analyzer/save] GHL sync failed:', msg)
      ghlError = msg
    }

    return NextResponse.json({ success: true, dealUrl, ghlSynced, ghlError })
  } catch (err) {
    console.error('[analyzer/save] Neon error:', err)
    return NextResponse.json({ error: 'Failed to save deal' }, { status: 500 })
  }
}
