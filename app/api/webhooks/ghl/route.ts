import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { provisionSubAccount, suspendSubAccount, updateGHLContact } from '@/lib/ghl'
import { sendWelcomeEmail } from '@/lib/resend'

interface GHLPayload {
  event: string
  contact: {
    id: string
    name: string
    email: string
    phone: string
  }
  product: string
  plan: string
  amount: number
}

export async function POST(req: NextRequest) {
  // Verify shared secret
  const incomingSecret = req.headers.get('x-reiblast-secret')
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET

  if (!incomingSecret || incomingSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: GHLPayload

  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[GHL webhook] incoming payload:', JSON.stringify(payload, null, 2))
  } else {
    console.log(`[GHL webhook] event=${payload.event} email=${payload.contact?.email}`)
  }

  try {
    switch (payload.event) {
      case 'order.fulfilled':
        return await handleOrderFulfilled(payload)

      case 'subscription.cancelled':
        return await handleSubscriptionCancelled(payload)

      default:
        console.log(`[GHL webhook] unhandled event type: ${payload.event}`)
        return NextResponse.json({ received: true })
    }
  } catch (err) {
    console.error('[GHL webhook] error:', err, '\npayload:', JSON.stringify(payload))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function handleOrderFulfilled(payload: GHLPayload) {
  const { id: contactId, name, email } = payload.contact

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      status: 'active',
      plan: 'core',
      ghlSubAccount: contactId,
    },
    create: {
      email: email.toLowerCase(),
      name,
      plan: 'core',
      status: 'active',
      ghlSubAccount: contactId,
    },
  })

  const { locationId } = await provisionSubAccount(name, email, contactId)

  await prisma.user.update({
    where: { id: user.id },
    data: { ghlLocationId: locationId },
  })

  await updateGHLContact(contactId, {
    plan: 'core',
    status: 'active',
    locationId,
    loginUrl: `${process.env.NEXT_PUBLIC_TOOLS_URL ?? 'https://tools.reiblast.app'}/login`,
  })

  await sendWelcomeEmail(name, email)

  console.log(`[GHL webhook] order.fulfilled success — user=${user.id} location=${locationId}`)

  return NextResponse.json({ success: true, locationId })
}

async function handleSubscriptionCancelled(payload: GHLPayload) {
  const { email } = payload.contact

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, ghlLocationId: true },
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

  console.log(`[GHL webhook] subscription.cancelled success — email=${email}`)

  return NextResponse.json({ success: true })
}
