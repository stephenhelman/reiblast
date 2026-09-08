'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { verifyOtpAction, resendOtpAction, type VerifyState, type ResendState } from './actions'

const initialVerifyState: VerifyState = {}
const initialResendState: ResendState = {}

function VerifyButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Verifying…' : 'Verify'}
    </button>
  )
}

function ResendButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Sending…' : 'Resend code'}
    </button>
  )
}

export function OtpForm({ locationId }: { locationId: string }) {
  const [verifyState, verifyAction] = useFormState(verifyOtpAction, initialVerifyState)
  const [resendState, resendAction] = useFormState(resendOtpAction, initialResendState)

  return (
    <div>
      <form action={verifyAction}>
        <input type="hidden" name="locationId" value={locationId} />
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="6-digit code"
          required
          autoFocus
        />
        <VerifyButton />
      </form>

      {verifyState.error && (
        <p style={{ color: '#b91c1c' }}>
          {verifyState.error}
          {typeof verifyState.attemptsRemaining === 'number'
            ? ` (${verifyState.attemptsRemaining} attempts remaining)`
            : ''}
        </p>
      )}

      <form action={resendAction} style={{ marginTop: 16 }}>
        <input type="hidden" name="locationId" value={locationId} />
        <ResendButton />
      </form>

      {resendState.cooldown && <p>A code was already sent — check your phone.</p>}
      {resendState.sent && <p>A new code has been sent.</p>}
      {resendState.error && <p style={{ color: '#b91c1c' }}>{resendState.error}</p>}
    </div>
  )
}
