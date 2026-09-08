'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { verifyOtpAction, resendOtpAction, type VerifyState, type ResendState } from './actions'

const initialVerifyState: VerifyState = {}
const initialResendState: ResendState = {}

function VerifyButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-gold py-3 font-bold text-black transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Verifying…' : 'Verify'}
    </button>
  )
}

function ResendButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm text-white/50 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Sending…' : 'Resend code'}
    </button>
  )
}

export function OtpForm({ locationId }: { locationId: string }) {
  const [verifyState, verifyAction] = useFormState(verifyOtpAction, initialVerifyState)
  const [resendState, resendAction] = useFormState(resendOtpAction, initialResendState)

  return (
    <div>
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="locationId" value={locationId} />
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="6-digit code"
          required
          autoFocus
          className="w-full rounded-xl border border-border-default bg-black px-4 py-3 text-center text-lg tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-white/30 focus:border-gold focus:outline-none"
        />
        <VerifyButton />
      </form>

      {verifyState.error && (
        <p className="mt-4 text-sm text-red-400">
          {verifyState.error}
          {typeof verifyState.attemptsRemaining === 'number'
            ? ` (${verifyState.attemptsRemaining} attempts remaining)`
            : ''}
        </p>
      )}

      <form action={resendAction} className="mt-6">
        <input type="hidden" name="locationId" value={locationId} />
        <ResendButton />
      </form>

      {resendState.cooldown && <p className="mt-3 text-sm text-white/50">A code was already sent — check your phone.</p>}
      {resendState.sent && <p className="mt-3 text-sm text-white/50">A new code has been sent.</p>}
      {resendState.error && <p className="mt-3 text-sm text-red-400">{resendState.error}</p>}
    </div>
  )
}
