import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { provisionSubAccount } from '@/lib/ghl'
import { sendWelcomeEmail } from '@/lib/resend'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('[stripe webhook] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const email = session.customer_email ?? (session.metadata?.email ?? '')
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string

        if (email) {
          const user = await prisma.user.update({
            where: { email: email.toLowerCase() },
            data: {
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              status: 'active',
            },
          })

          const locationId = await provisionSubAccount(user.name ?? user.email, user.email, '')
          await prisma.user.update({
            where: { id: user.id },
            data: { ghlLocationId: locationId },
          })

          await sendWelcomeEmail(user.name ?? 'there', user.email)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: { status: 'inactive' },
        })
        break
      }

      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe webhook] handler error', err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}
