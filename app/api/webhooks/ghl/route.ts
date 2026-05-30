import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { suspendSubAccount } from '@/lib/ghl'

export async function POST(req: NextRequest) {
  const incomingSecret = req.headers.get('x-reiblast-secret')
  if (!incomingSecret || incomingSecret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { event: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log(`[GHL webhook] event=${body.event} email=${body.email}`)

  try {
    if (body.event === 'order.fulfilled') {
      if (body.email) {
        await prisma.user.updateMany({
          where: { email: body.email.toLowerCase() },
          data: { status: 'active' },
        })
      }
      return NextResponse.json({ success: true })
    }

    if (body.event === 'subscription.cancelled') {
      if (body.email) {
        const user = await prisma.user.findFirst({
          where: { email: body.email.toLowerCase() },
        })
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { status: 'inactive' },
          })
          if (user.ghlLocationId) {
            await suspendSubAccount(user.ghlLocationId)
          }
        }
      }
      return NextResponse.json({ success: true })
    }

    console.log(`[GHL webhook] unhandled event: ${body.event}`)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[GHL webhook] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
