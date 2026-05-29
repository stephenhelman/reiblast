import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { provisionSubAccount, suspendSubAccount, updateGHLContact } from '@/lib/ghl'
import { sendWelcomeEmail } from '@/lib/resend'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GHLOrderFulfilledPayload {
  type: 'OrderFulfilled'
  contactId: string
  contactName: string
  contactEmail: string
  productName: string
  subscriptionId: string
}

interface GHLSubscriptionCancelledPayload {
  type: 'SubscriptionCancelled'
  contactId: string
  contactEmail: string
  subscriptionId: string
}

type GHLPayload = GHLOrderFulfilledPayload | GHLSubscriptionCancelledPayload

// ─── Signature verification ────────────────────────────────────────────────────

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret || !signature) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  )
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-ghl-signature')

  if (!verifySignature(body, signature)) {
    console.warn('[GHL webhook] signature verification failed')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: GHLPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[GHL webhook] incoming payload:', JSON.stringify(payload, null, 2))
  }

  try {
    switch (payload.type) {
      case 'OrderFulfilled':
        await handleOrderFulfilled(payload)
        break

      case 'SubscriptionCancelled':
        await handleSubscriptionCancelled(payload)
        break

      default:
        console.log(`[GHL webhook] unhandled event type: ${(payload as GHLPayload).type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[GHL webhook] handler error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleOrderFulfilled(payload: GHLOrderFulfilledPayload) {
  const { contactId, contactName, contactEmail, subscriptionId } = payload

  const user = await prisma.user.upsert({
    where: { email: contactEmail.toLowerCase() },
    update: {
      plan: 'core',
      status: 'active',
      stripeSubscriptionId: subscriptionId,
    },
    create: {
      email: contactEmail.toLowerCase(),
      name: contactName,
      plan: 'core',
      status: 'active',
      stripeSubscriptionId: subscriptionId,
    },
  })

  const locationId = await provisionSubAccount(contactName, contactEmail, contactId)

  await prisma.user.update({
    where: { id: user.id },
    data: { ghlLocationId: locationId, ghlSubAccount: contactId },
  })

  await updateGHLContact(contactId, {
    plan: 'core',
    status: 'active',
    locationId,
    loginUrl: `${process.env.NEXT_PUBLIC_TOOLS_URL ?? 'https://tools.reiblast.app'}/login`,
  })

  await sendWelcomeEmail(contactName, contactEmail)

  console.log(`[GHL webhook] OrderFulfilled processed — user=${user.id} location=${locationId}`)
}

async function handleSubscriptionCancelled(payload: GHLSubscriptionCancelledPayload) {
  const { contactId, contactEmail } = payload

  const user = await prisma.user.updateMany({
    where: { email: contactEmail.toLowerCase() },
    data: { status: 'inactive' },
  })

  if (user.count > 0 && contactId) {
    const record = await prisma.user.findUnique({
      where: { email: contactEmail.toLowerCase() },
      select: { ghlLocationId: true },
    })
    if (record?.ghlLocationId) {
      await suspendSubAccount(record.ghlLocationId)
    }
    await updateGHLContact(contactId, { status: 'inactive' })
  }

  console.log(`[GHL webhook] SubscriptionCancelled processed — email=${contactEmail}`)
}
