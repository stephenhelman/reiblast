import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { moveToStage } from '@/lib/ghl'
import { ONBOARDING_STAGES, SUPPORT_EMAIL } from '@/lib/constants'

const REQUIRED_FIELDS = [
  'email', 'legalBusinessName', 'ein', 'businessType',
  'businessAddress', 'businessCity', 'businessState', 'businessZip',
  'businessPhone', 'businessEmail', 'targetMarket', 'smsComplianceAgreed',
]

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] && body[field] !== false) {
      return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 })
    }
  }

  if (!/^\d{2}-\d{7}$/.test(body.ein as string)) {
    return NextResponse.json({ error: 'EIN must be in format XX-XXXXXXX' }, { status: 400 })
  }

  if (body.smsComplianceAgreed !== true) {
    return NextResponse.json({ error: 'SMS compliance agreement is required' }, { status: 400 })
  }

  const email = (body.email as string).toLowerCase()

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'Account not found. Please contact support.' }, { status: 404 })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        businessName: body.legalBusinessName as string,
        ein: body.ein as string,
        businessType: body.businessType as string,
        businessAddress: body.businessAddress as string,
        businessCity: body.businessCity as string,
        businessState: body.businessState as string,
        businessZip: body.businessZip as string,
        businessPhone: body.businessPhone as string,
        businessEmail: body.businessEmail as string,
        websiteUrl: (body.websiteUrl as string) || null,
        targetMarket: body.targetMarket as string,
        smsComplianceAgreed: true,
        onboardingComplete: true,
        onboardingStage: ONBOARDING_STAGES.ONBOARDING_FORM_SUBMITTED,
        status: 'onboarding_complete',
      },
    })

    const contactId = user.ghlContactId!
    const contactName = user.name || email

    try {
      await moveToStage(contactId, ONBOARDING_STAGES.ONBOARDING_FORM_SUBMITTED, contactName)
      console.log('[onboarding/submit] Stage moved successfully for', contactId)
    } catch (stageErr) {
      console.error('[onboarding/submit] moveToStage failed:', stageErr)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/submit] error:', err)
    return NextResponse.json(
      { error: `Account setup failed. Please contact ${SUPPORT_EMAIL}` },
      { status: 500 }
    )
  }
}
