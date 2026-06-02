import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  moveToStage,
  provisionSubAccount,
  populateA2PSite,
  addTag,
} from '@/lib/ghl'
import { MEMBER_TAGS, ONBOARDING_STAGES } from '@/lib/constants'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-reiblast-secret')
  if (!secret || secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = (body.email as string) || ''
  const contactId = (body.id as string) || ''
  const name =
    (body.full_name as string) ||
    `${(body.first_name as string) || ''} ${(body.last_name as string) || ''}`.trim()
  const phone = (body.phone as string) || ''

  if (!email || !contactId) {
    console.error('[ghl-provision] Missing email or contactId', body)
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase()

  const user = await prisma.user.findFirst({ where: { email: normalizedEmail } })
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

    await moveToStage(contactId, ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED, name)

    const { locationId, userId } = await provisionSubAccount(
      name || user.name || normalizedEmail,
      normalizedEmail,
      user.businessName || name,
      user.businessPhone || phone,
      contactId,
      user.businessAddress || '',
      user.businessCity || '',
      user.businessState || '',
      user.businessZip || '',
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
      businessName: user.businessName || '',
      businessAddress: user.businessAddress || '',
      businessCity: user.businessCity || '',
      businessState: user.businessState || '',
      businessZip: user.businessZip || '',
      businessPhone: user.businessPhone || phone,
      businessEmail: user.businessEmail || normalizedEmail,
    })

    // GHL automation detects 'Onboarding Complete' tag and sends the welcome
    // email with login credentials and temp password automatically
    await addTag(contactId, MEMBER_TAGS.ONBOARDING_COMPLETE)
    await addTag(contactId, MEMBER_TAGS.ACTIVE)
    await addTag(contactId, MEMBER_TAGS.A2P_PENDING)

    await moveToStage(contactId, ONBOARDING_STAGES.ACTIVE, name)

    return NextResponse.json({
      success: true,
      locationId,
      message: 'Sub-account provisioned successfully',
    })
  } catch (err) {
    console.error(`[ghl-provision] error contactId=${contactId} email=${normalizedEmail}:`, err)
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'onboarding_complete' },
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
