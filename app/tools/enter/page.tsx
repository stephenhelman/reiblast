import { prisma } from '@/lib/prisma'
import { mintOtp } from '@/lib/otp'
import { TOOLS_OTP_SEND_COOLDOWN_MS } from '@/lib/constants'
import { OtpForm } from './OtpForm'

export const dynamic = 'force-dynamic'

function Screen({ title, message, children }: { title: string; message?: string; children?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>{title}</h1>
      {message && <p>{message}</p>}
      {children}
    </div>
  )
}

export default async function EnterPage({
  searchParams,
}: {
  searchParams: { locationId?: string }
}) {
  const locationId = searchParams.locationId || ''

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
      <p>{withinCooldown ? 'A code was already sent — check your phone.' : 'We texted a 6-digit code to your phone.'}</p>
      <OtpForm locationId={locationId} />
    </Screen>
  )
}
