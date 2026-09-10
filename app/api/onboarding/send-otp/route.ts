import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mintOtp, redeliverOtp } from '@/lib/otp'
import { ONBOARDING_OTP_VISIBILITY_FIELD } from '@/lib/constants'
import { guardRegion } from '@/lib/geo'

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

function hqHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  const masked = local.slice(0, 2) + '***'
  return `${masked}@${domain}`
}

export async function POST(req: NextRequest) {
  // US-only funnel gate — mirrors the middleware page gate so the endpoint
  // behind the form can't be called directly from a blocked region.
  const blocked = guardRegion(req)
  if (blocked) return blocked

  try {
    const { contactId } = await req.json()
    if (!contactId) {
      return NextResponse.json({ error: 'contactId required' }, { status: 400 })
    }

    const user = await prisma.user.findFirst({
      where: { ghlContactId: contactId },
    })

    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const contactRes = await fetch(`${GHL_BASE_URL}/contacts/${contactId}`, {
      headers: hqHeaders(),
    })

    if (!contactRes.ok) {
      throw new Error(`Failed to fetch contact: ${contactRes.status}`)
    }

    const contactData = await contactRes.json()
    const contact = contactData.contact
    const email: string = contact?.email || ''
    const phone: string = contact?.phone || ''

    if (!email) {
      return NextResponse.json({ error: 'No email on contact' }, { status: 400 })
    }

    const hasLiveCode =
      user.otpCode && user.otpExpiry && user.otpExpiry > new Date() && user.otpAttempts < 3

    const otpArgs = {
      userId: user.id,
      contactId,
      phone,
      visibilityField: ONBOARDING_OTP_VISIBILITY_FIELD,
      flow: 'onboarding' as const,
    }

    const result = hasLiveCode ? await redeliverOtp(otpArgs) : await mintOtp(otpArgs)
    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send code' }, { status: 500 })
    }

    return NextResponse.json({ success: true, maskedEmail: maskEmail(email) })
  } catch (err) {
    console.error('[send-otp] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
