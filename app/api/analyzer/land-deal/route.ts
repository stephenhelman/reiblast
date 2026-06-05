import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get('dealId')
  const locationId = req.nextUrl.searchParams.get('locationId')

  if (!dealId || !locationId) {
    return NextResponse.json({ error: 'dealId and locationId are required' }, { status: 400 })
  }

  try {
    const deal = await prisma.landDeal.findFirst({
      where: { id: dealId, locationId },
    })

    if (!deal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(deal)
  } catch (err) {
    console.error('[land-deal] error:', err)
    return NextResponse.json({ error: 'Failed to load deal' }, { status: 500 })
  }
}
