import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const locationId = req.nextUrl.searchParams.get('locationId')
  console.log('[check-connection] Connection check for locationId', locationId)

  if (!locationId) {
    return NextResponse.json({ connected: false })
  }

  try {
    const record = await prisma.ghlToken.findUnique({ where: { locationId } })
    const connected = !!record
    console.log('[check-connection] Connected:', connected)
    return NextResponse.json({ connected })
  } catch (err) {
    console.error('[check-connection] Error:', err)
    return NextResponse.json({ connected: false })
  }
}
