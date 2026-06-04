import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dealId = searchParams.get('dealId')
  const locationId = searchParams.get('locationId')

  if (!dealId || !locationId) {
    return NextResponse.json({ error: 'dealId and locationId are required' }, { status: 400 })
  }

  console.log('[analyzer/deal] Deal lookup for id:', dealId)

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, locationId },
  })

  if (!deal) {
    console.log('[analyzer/deal] Deal not found')
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  console.log('[analyzer/deal] Deal found for locationId:', locationId)

  return NextResponse.json(deal)
}
