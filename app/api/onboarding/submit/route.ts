import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  moveToStage,
  provisionSubAccount,
  populateA2PSite,
  addTag,
} from '@/lib/ghl'
import { MEMBER_TAGS, ONBOARDING_STAGES, SUPPORT_EMAIL } from '@/lib/constants'

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

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] && body[field] !== false) {
      return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 })
    }
  }

  // Validate EIN format
  if (!/^\d{2}-\d{7}$/.test(body.ein as string)) {
    return NextResponse.json({ error: 'EIN must be in format XX-XXXXXXX' }, { status: 400 })
  }

  // Validate SMS compliance
  if (body.smsComplianceAgreed !== true) {
    return NextResponse.json({ error: 'SMS compliance agreement is required' }, { status: 400 })
  }

  const email = (body.email as string).toLowerCase()

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'Account not found. Please contact support.' }, { status: 404 })
    }

    // Save business info and mark provisioning started
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
        status: 'provisioning',
      },
    })

    const contactId = user.ghlContactId!

    await moveToStage(contactId, ONBOARDING_STAGES.ONBOARDING_FORM_SUBMITTED)

    const { locationId, userId } = await provisionSubAccount(
      user.name || email,
      email,
      body.legalBusinessName as string,
      contactId
    )

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ghlLocationId: locationId,
        ghlUserId: userId,
        status: 'active',
        onboardingStage: ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED,
      },
    })

    await moveToStage(contactId, ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED)

    await populateA2PSite(locationId, {
      businessName: body.legalBusinessName as string,
      businessAddress: body.businessAddress as string,
      businessCity: body.businessCity as string,
      businessState: body.businessState as string,
      businessZip: body.businessZip as string,
      businessPhone: body.businessPhone as string,
      businessEmail: body.businessEmail as string,
      websiteUrl: body.websiteUrl as string | undefined,
    })

    await addTag(contactId, MEMBER_TAGS.ONBOARDING_COMPLETE)
    await addTag(contactId, MEMBER_TAGS.ACTIVE)
    await addTag(contactId, MEMBER_TAGS.A2P_PENDING)

    await moveToStage(contactId, ONBOARDING_STAGES.ACTIVE)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/submit] error:', err)
    return NextResponse.json(
      { error: `Account setup failed. Please contact ${SUPPORT_EMAIL}` },
      { status: 500 }
    )
  }
}
