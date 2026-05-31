import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TOOLS_URL } from '@/lib/constants'

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

    let ghlWarning: string | undefined
    if (process.env.GHL_API_KEY) {
      try {
        const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            locationId,
            name: address,
            address1: address,
            customFields: [
              { key: 'analysis_url', field_value: dealUrl },
              { key: 'analysis_arv', field_value: arv },
              { key: 'analysis_ebm', field_value: endBuyerMax },
              { key: 'analysis_repair_level', field_value: repairLevel },
              { key: 'analysis_repairs', field_value: repairs },
              { key: 'analysis_wholesale_fee', field_value: wholesaleFee },
              { key: 'analysis_mao', field_value: mao },
              { key: 'analysis_anchor', field_value: anchorOffer },
              { key: 'analysis_investor_percent', field_value: investorPct },
            ],
          }),
        })
        if (!ghlRes.ok) {
          const errText = await ghlRes.text()
          console.error('[analyzer/save] GHL upsert failed:', errText)
          ghlWarning = 'Deal saved, but CRM sync failed. Contact support if this persists.'
        }
      } catch (err) {
        console.error('[analyzer/save] GHL upsert error:', err)
        ghlWarning = 'Deal saved, but CRM sync failed. Contact support if this persists.'
      }
    }

    return NextResponse.json({ dealUrl: `${TOOLS_URL}/analyzer/deals/${deal.id}`, ghlWarning })
  } catch (err) {
    console.error('[analyzer/save] error:', err)
    return NextResponse.json({ error: 'Failed to save deal' }, { status: 500 })
  }
}
