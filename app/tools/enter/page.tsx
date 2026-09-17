import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { mintOtp, mintOtpDevStub } from '@/lib/otp'
import { verifyToolsSession } from '@/lib/toolsSession'
import { TOOLS_OTP_SEND_COOLDOWN_MS, TOOLS_SESSION_COOKIE } from '@/lib/constants'
import { OtpForm } from './OtpForm'
import { AutoAdminOtp } from './AutoAdminOtp'
import MinimalHeader from '@/components/tools/MinimalHeader'

export const dynamic = 'force-dynamic'

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function Screen({ title, message, children }: { title: string; message?: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black">
      <MinimalHeader title="REIblast Tools" />
      <div className="flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-8 text-center">
          <h1 className="mb-2 text-xl font-bold text-white">{title}</h1>
          {message && <p className="text-sm leading-relaxed text-white/50">{message}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}

export default async function EnterPage({
  searchParams,
}: {
  searchParams: { locationId?: string }
}) {
  const locationId = searchParams.locationId || ''

  // Already have a valid session for this location? Skip straight to the
  // tools landing instead of re-sending an OTP on every menu-link click.
  const cookieStore = await cookies()
  const existingToken = cookieStore.get(TOOLS_SESSION_COOKIE)?.value
  if (existingToken) {
    const session = await verifyToolsSession(existingToken)
    if (session && (!locationId || session.locationId === locationId)) {
      redirect('/')
    }
  }

  if (!locationId) {
    return (
      <Screen
        title="Access not available"
        message="Missing location. Reopen this tool from your CRM menu."
      />
    )
  }

  const user = await prisma.user.findFirst({ where: { ghlLocationId: locationId } })

  if (!user || user.status !== 'active') {
    return (
      <Screen
        title="Access not available"
        message="We couldn't verify your account. Reopen this tool from your CRM menu, or contact support."
      />
    )
  }

  // Admin is not a separate front door — same lookup → OTP → session flow as
  // any member, just gated on role rather than the A2P/KYC gate below (an
  // admin has no SMS-provisioned number to gate on). The OTP mint step is
  // stubbed in dev (no real SMS send) but the verify + session-write path is
  // identical to the member flow — go-live unstubs the send, not the model.
  if (user.role === 'admin') {
    const { code } = await mintOtpDevStub(user.id)
    return (
      <Screen title="Signing in as admin…">
        <AutoAdminOtp locationId={locationId} code={code} />
      </Screen>
    )
  }

  if (!user.a2pPhone) {
    return (
      <Screen
        title="Almost there"
        message="This tool unlocks once your first phone number is assigned (after KYC verification)."
      />
    )
  }

  if (!user.ghlContactId) {
    return (
      <Screen
        title="Access not available"
        message="Your account is missing contact info. Contact support."
      />
    )
  }

  const withinCooldown =
    !!user.otpLastSentAt && Date.now() - user.otpLastSentAt.getTime() < TOOLS_OTP_SEND_COOLDOWN_MS

  if (!withinCooldown) {
    const result = await mintOtp({
      userId: user.id,
      contactId: user.ghlContactId,
      phone: user.a2pPhone,
      flow: 'tools',
    })

    if (!result.success) {
      return (
        <Screen
          title="Couldn't send code"
          message="We couldn't send your verification code. Please reload this page to try again."
        />
      )
    }
  }

  return (
    <Screen title="Enter your code">
      <p className="mb-6 text-sm text-white/50">
        {withinCooldown ? 'A code was already sent to' : 'We sent a code to'} {formatPhone(user.a2pPhone)} inside your
        REIblast CRM. Enter that code here.
      </p>
      <OtpForm locationId={locationId} />
    </Screen>
  )
}
