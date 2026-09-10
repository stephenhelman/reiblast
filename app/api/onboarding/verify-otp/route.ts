import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyOtp } from '@/lib/otp'
import { ONBOARDING_OTP_VISIBILITY_FIELD } from '@/lib/constants'
import { guardRegion } from '@/lib/geo'

export async function POST(req: NextRequest) {
  // US-only funnel gate — mirrors the middleware page gate so the endpoint
  // behind the form can't be called directly from a blocked region.
  const blocked = guardRegion(req)
  if (blocked) return blocked

  try {
    const body = await req.json()
    const { contactId, otp } = body

    if (!contactId || !otp) {
      return NextResponse.json({ error: 'contactId and otp required' }, { status: 400 })
    }

    const user = await prisma.user.findFirst({
      where: { ghlContactId: contactId },
    })

    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const result = await verifyOtp({
      userId: user.id,
      code: otp,
      contactId,
      visibilityField: ONBOARDING_OTP_VISIBILITY_FIELD,
    })

    if (result.status === 'expired') {
      return NextResponse.json(
        { error: 'Code expired. Request a new one.' },
        { status: 400 },
      )
    }

    if (result.status === 'locked_out') {
      return NextResponse.json(
        { error: 'Invalid code. Try again.' },
        { status: 400 },
      )
    }

    if (result.status === 'wrong') {
      return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    }

    return NextResponse.json({ success: true, email: user.email })
  } catch (err) {
    console.error('[verify-otp] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
