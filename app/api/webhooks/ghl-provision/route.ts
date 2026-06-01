import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  moveToStage,
  provisionSubAccount,
  populateA2PSite,
  addTag,
} from '@/lib/ghl'
import { MEMBER_TAGS, ONBOARDING_STAGES } from '@/lib/constants'

interface ProvisionPayload {
  contactId: string
  email: string
  name: string
  phone: string
  businessName: string
  ein: string
  businessAddress: string
  businessCity: string
  businessState: string
  businessZip: string
  targetMarket: string
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-reiblast-secret')
  if (!secret || secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ProvisionPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    contactId,
    email,
    name,
    phone,
    businessName,
    businessAddress,
    businessCity,
    businessState,
    businessZip,
  } = body

  const normalizedEmail = email.toLowerCase()

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (user.ghlLocationId) {
    return NextResponse.json(
      { message: 'Already provisioned', locationId: user.ghlLocationId },
      { status: 200 }
    )
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'provisioning' },
    })

    await moveToStage(contactId, ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED)

    const { locationId, userId } = await provisionSubAccount(
      name,
      normalizedEmail,
      businessName,
      phone,
      contactId,
    )

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ghlLocationId: locationId,
        ghlUserId: userId,
        status: 'active',
        onboardingComplete: true,
      },
    })

    await populateA2PSite(locationId, {
      businessName,
      businessAddress,
      businessCity,
      businessState,
      businessZip,
      businessPhone: phone,
      businessEmail: normalizedEmail,
    })

    // GHL automation detects 'Onboarding Complete' tag and sends the welcome
    // email with login credentials and temp password automatically
    await addTag(contactId, MEMBER_TAGS.ONBOARDING_COMPLETE)
    await addTag(contactId, MEMBER_TAGS.ACTIVE)
    await addTag(contactId, MEMBER_TAGS.A2P_PENDING)

    await moveToStage(contactId, ONBOARDING_STAGES.ACTIVE)

    return NextResponse.json({
      success: true,
      locationId,
      message: 'Sub-account provisioned successfully',
    })
  } catch (err) {
    console.error(`[ghl-provision] error contactId=${contactId} email=${normalizedEmail}:`, err)
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'pending_onboarding' },
    })
    return NextResponse.json(
      {
        error: 'Provisioning failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
