import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { moveToStage, updateHQContact } from '@/lib/ghl'
import { ONBOARDING_STAGES, SUPPORT_EMAIL, ONBOARDING_COOKIE, ONBOARDING_COOKIE_MAX_AGE_SECONDS } from '@/lib/constants'
import { guardRegion } from '@/lib/geo'
import { signOnboardingCookie } from '@/lib/onboardingSession'
import { toolsOnboardingEnabled } from '@/lib/featureFlags'

const REQUIRED_FIELDS = [
  'email', 'legalBusinessName', 'ein', 'businessType',
  'businessAddress', 'businessCity', 'businessState', 'businessZip',
  'businessPhone', 'businessEmail', 'targetMarket', 'smsComplianceAgreed',
]

export async function POST(req: NextRequest) {
  // US-only funnel gate — mirrors the middleware page gate so the endpoint
  // behind the form can't be called directly from a blocked region.
  const blocked = guardRegion(req)
  if (blocked) return blocked

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
      await updateHQContact(contactId, {
        business_name: body.legalBusinessName as string,
        ein: body.ein as string,
        business_type: body.businessType as string,
        business_address: body.businessAddress as string,
        business_city: body.businessCity as string,
        business_state: body.businessState as string,
        business_zip: body.businessZip as string,
        business_phone: body.businessPhone as string,
        business_email: body.businessEmail as string,
        website_url: (body.websiteUrl as string) || '',
        target_market: body.targetMarket as string,
        sms_compliance_agreed: 'true',
        onboarding_stage: 'Onboarding Form Submitted',
      })
      console.log('[onboarding/submit] GHL contact updated')
    } catch (ghlErr) {
      console.error('[onboarding/submit] GHL contact update failed:', ghlErr)
      // Non-blocking — DB is source of truth
    }

    try {
      await moveToStage(contactId, ONBOARDING_STAGES.ONBOARDING_FORM_SUBMITTED, contactName)
      console.log('[onboarding/submit] Stage moved successfully for', contactId)
    } catch (stageErr) {
      console.error('[onboarding/submit] moveToStage failed:', stageErr)
    }

    // TEMP launch gate — remove at tools launch, tools path becomes default.
    // Flag off: identical to main's response (plain success, no cookie).
    // Flag on: mint the onboarding-identity cookie the tools funnel
    // (welcome -> discovery) reads to autofill its info modal.
    if (!toolsOnboardingEnabled()) {
      return NextResponse.json({ success: true })
    }

    const response = NextResponse.json({ success: true })

    // Mint the signed onboarding-identity cookie on the success path —
    // discovery reads this to autofill its info modal. Same helper, cookie
    // name, and options as app/marketing/discovery/actions.ts's
    // setOnboardingCookieAction, so both mint paths produce an identical
    // cookie. contactId is the SAME ghlContactId updateHQContact used above
    // (the HQ-targetable id) — never User.id, never email. Phone comes from
    // `body.businessPhone` (the value just validated + written to the DB),
    // not the pre-update `user.businessPhone`, which is still null the first
    // time this route ever sets it.
    const onboardingToken = await signOnboardingCookie({
      contactId,
      name: contactName,
      email,
      phone: (body.businessPhone as string) || '',
    })
    response.cookies.set(ONBOARDING_COOKIE, onboardingToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: ONBOARDING_COOKIE_MAX_AGE_SECONDS,
      path: '/',
    })

    return response
  } catch (err) {
    console.error('[onboarding/submit] error:', err)
    return NextResponse.json(
      { error: `Account setup failed. Please contact ${SUPPORT_EMAIL}` },
      { status: 500 }
    )
  }
}
