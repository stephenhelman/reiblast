import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
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

    if (!user.otpCode) {
      return NextResponse.json(
        { error: 'No code found. Request a new one.' },
        { status: 400 },
      )
    }

    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      return NextResponse.json(
        { error: 'Code expired. Request a new one.' },
        { status: 400 },
      )
    }

    if (user.otpCode !== otp) {
      return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiry: null },
    })

    return NextResponse.json({ success: true, email: user.email })
  } catch (err) {
    console.error('[verify-otp] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
