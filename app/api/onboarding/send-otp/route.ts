import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendOTPEmail } from '@/lib/ghl'

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

    let otp = user.otpCode
    let otpExpiry = user.otpExpiry

    if (!otp || !otpExpiry || otpExpiry < new Date()) {
      otp = Math.floor(100000 + Math.random() * 900000).toString()
      otpExpiry = new Date(Date.now() + 10 * 60 * 1000)
      await prisma.user.update({
        where: { id: user.id },
        data: { otpCode: otp, otpExpiry },
      })
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
    const firstName: string = contact?.firstName || ''

    if (!email) {
      return NextResponse.json({ error: 'No email on contact' }, { status: 400 })
    }

    await sendOTPEmail(contactId, email, otp, user.name || firstName)

    return NextResponse.json({ success: true, maskedEmail: maskEmail(email) })
  } catch (err) {
    console.error('[send-otp] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
