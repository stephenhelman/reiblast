import { NextRequest, NextResponse } from 'next/server'
import { HighLevel, GHLError } from '@gohighlevel/api-client'
import { prisma } from '@/lib/prisma'
import { getLocationToken } from '@/lib/ghl'
import { TOOLS_URL } from '@/lib/constants'

function makeGHLClient(token: string) {
  return new HighLevel({ privateIntegrationToken: token })
}

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

  // CHANGE 2 — log 1: full request body (no sensitive redaction needed here)
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
    // CHANGE 2 — log 2: writing to Neon
    console.log('[analyzer/save] Writing to Neon. address:', address, '| locationId:', locationId)

    deal = await prisma.deal.upsert({
      where: { locationId_address: { locationId, address } },
      create: {
        locationId,
        address,
        arv,
        endBuyerMax,
        repairLevel,
        repairs,
        wholesaleFee,
        mao,
        anchorOffer,
        investorPct,
        narrative,
        compsUsed,
        dealUrl: '',
      },
      update: {
        arv,
        endBuyerMax,
        repairLevel,
        repairs,
        wholesaleFee,
        mao,
        anchorOffer,
        investorPct,
        narrative,
        compsUsed,
      },
      select: { id: true },
    })

    const dealUrl = `${TOOLS_URL}/analyzer/deals/${deal.id}`
    await prisma.deal.update({
      where: { id: deal.id },
      data: { dealUrl },
    })

    // CHANGE 2 — log 3: Neon write result
    console.log('[analyzer/save] Neon write result. deal.id:', deal.id, '| dealUrl:', dealUrl)

    let ghlWarning: string | undefined

    let locationToken: string | null = null
    try {
      locationToken = await getLocationToken(locationId)
    } catch (err) {
      console.warn('[analyzer/save] Could not get location token — GHL sync skipped:', err)
    }
    console.log('[analyzer/save] Location token resolved:', locationToken ? 'yes' : 'not found')

    if (locationToken) {
      // CHANGE 3 — custom fields sent with both key and id (id undefined until GHL confirms field IDs)
      const customFields = [
        { key: 'analysis_url',              id: undefined, field_value: dealUrl },
        { key: 'analysis_arv',              id: undefined, field_value: arv },
        { key: 'analysis_ebm',              id: undefined, field_value: endBuyerMax },
        { key: 'analysis_repair_level',     id: undefined, field_value: repairLevel },
        { key: 'analysis_repairs',          id: undefined, field_value: repairs },
        { key: 'analysis_wholesale_fee',    id: undefined, field_value: wholesaleFee },
        { key: 'analysis_mao',              id: undefined, field_value: mao },
        { key: 'analysis_anchor',           id: undefined, field_value: anchorOffer },
        { key: 'analysis_investor_percent', id: undefined, field_value: investorPct },
      ]

      // CHANGE 2 — log 4: GHL call details
      console.log(
        '[analyzer/save] Calling GHL upsert. locationId:', locationId,
        '| address:', address,
        '| customFields:', JSON.stringify(customFields),
      )

      try {
        const ghl = makeGHLClient(locationToken)
        const ghlResponse = await ghl.contacts.upsertContact(
          {
            locationId,
            name: address,
            address1: address,
            customFields,
          },
          { headers: { Version: '2021-07-28' } },
        )

        // CHANGE 2 — log 5: full GHL response
        console.log('[analyzer/save] GHL response:', JSON.stringify(ghlResponse))
      } catch (err) {
        if (err instanceof GHLError) {
          // CHANGE 2 — log 6: structured GHL error
          console.error('[analyzer/save] GHL error. statusCode:', err.statusCode)
          console.error('[analyzer/save] GHL error message:', err.message)
          console.error('[analyzer/save] GHL error response body:', JSON.stringify(err.response))

          // CHANGE 3 — hint if field IDs are required
          const body = JSON.stringify(err.response ?? '')
          if (
            body.toLowerCase().includes('field') &&
            (body.toLowerCase().includes('id') || body.toLowerCase().includes('key'))
          ) {
            console.error(
              '[analyzer/save] GHL requires field IDs — keys are not accepted by this endpoint'
            )
          }
        } else {
          console.error('[analyzer/save] GHL error (non-GHLError):', err)
        }
        ghlWarning = 'Deal saved, but CRM sync failed. Contact support if this persists.'
      }
    }

    return NextResponse.json({ dealUrl, ghlWarning })
  } catch (err) {
    console.error('[analyzer/save] Neon error:', err)
    return NextResponse.json({ error: 'Failed to save deal' }, { status: 500 })
  }
}
