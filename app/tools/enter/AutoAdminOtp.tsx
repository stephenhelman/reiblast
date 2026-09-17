'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import { verifyOtpAction, type VerifyState } from './actions'

const initialState: VerifyState = {}

/**
 * Auto-passes the OTP step for the admin dev flow — same verifyOtpAction as
 * the member OtpForm (same session write, same cookie), just submitted by
 * the client on mount instead of by a human typing a code. This is the
 * "stub the send, not the model" shape: mint already happened server-side
 * (mintOtpDevStub), this component only drives the existing verify step.
 */
export function AutoAdminOtp({ locationId, code }: { locationId: string; code: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction] = useFormState(verifyOtpAction, initialState)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!submitted) {
      setSubmitted(true)
      formRef.current?.requestSubmit()
    }
  }, [submitted])

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="code" value={code} />
      <p className="mt-4 text-sm text-white/40">{state.error ? state.error : 'Verifying…'}</p>
    </form>
  )
}
