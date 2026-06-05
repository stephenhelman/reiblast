import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const locationId = req.nextUrl.searchParams.get('locationId')
  if (!locationId) {
    return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
  }

  const user = await prisma.user.findFirst({
    where: { ghlLocationId: locationId },
    select: { addons: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  return NextResponse.json({
    addons: user.addons,
    a2p: user.addons.includes('a2p'),
    acqBot: user.addons.includes('acq-bot'),
    dispoBot: user.addons.includes('dispo-bot'),
    contracts: user.addons.includes('contracts'),
    askAri: user.addons.includes('ask-ari'),
  })
}
