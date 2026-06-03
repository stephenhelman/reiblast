'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Input from '@/components/shared/Input'
import Button from '@/components/shared/Button'
import { LogoStacked } from '@/components/shared/Logo'
import { GHL_APP_URL, SUPPORT_EMAIL } from '@/lib/constants'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
  'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV','WI','WY',
]

const BUSINESS_TYPES = ['LLC', 'Corporation', 'Sole Proprietorship', 'Partnership']

const LOADING_MESSAGES = [
  'Verifying your information...',
  'Setting up your account...',
  'Applying your workspace...',
  'Configuring your CRM...',
  'Almost ready...',
]

type GateState = 'checking' | 'not_found' | 'active' | 'onboarding_complete' | 'pending_onboarding'
type VerifyState = 'find' | 'select' | 'authorizing' | 'otp'

interface Contact {
  contactId: string
  displayName: string
  maskedEmail: string
  createdAt: string
}

interface Step1Fields {
  email: string
  legalBusinessName: string
  ein: string
  businessType: string
  businessAddress: string
  businessCity: string
  businessState: string
  businessZip: string
  businessPhone: string
  businessEmail: string
  websiteUrl: string
  targetMarket: string
}

function StepIndicator({ step }: { step: number }) {
  const steps = ['Business Info', 'SMS Compliance', 'Review']
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((label, i) => {
        const n = i + 1
        const active = n === step
        const done = n < step
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                  done
                    ? 'bg-gold border-gold text-black'
                    : active
                    ? 'border-gold text-gold bg-transparent'
                    : 'border-white/20 text-white/30 bg-transparent'
                }`}
              >
                {done ? '✓' : n}
              </div>
              <span className={`text-xs whitespace-nowrap ${active ? 'text-gold' : done ? 'text-white/60' : 'text-white/30'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 h-px mx-1 mb-5 ${n < step ? 'bg-gold' : 'bg-white/10'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function VerificationFlow() {
  const router = useRouter()
  const [state, setState] = useState<VerifyState>('find')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [otpValue, setOtpValue] = useState('')
  const [otpError, setOtpError] = useState('')
  const [findLoading, setFindLoading] = useState(false)
  const [findEmpty, setFindEmpty] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [showNotSeen, setShowNotSeen] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [failCount, setFailCount] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function findAccounts() {
    setFindLoading(true)
    setFindEmpty(false)
    try {
      const res = await fetch('/api/onboarding/recent-contacts')
      const data = await res.json()
      if (!data.contacts || data.contacts.length === 0) {
        setFindEmpty(true)
      } else {
        setContacts(data.contacts)
        setState('select')
      }
    } catch {
      setFindEmpty(true)
    } finally {
      setFindLoading(false)
    }
  }

  async function selectContact(contactId: string) {
    setSelectedId(contactId)
    setState('authorizing')
    setSendError(false)
    try {
      const res = await fetch('/api/onboarding/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      })
      const data = await res.json()
      if (res.ok) {
        setMaskedEmail(data.maskedEmail)
        setCooldown(60)
        setState('otp')
      } else {
        setSendError(true)
        setState('select')
      }
    } catch {
      setSendError(true)
      setState('select')
    }
  }

  async function resendOtp() {
    if (cooldown > 0) return
    setCooldown(60)
    try {
      const res = await fetch('/api/onboarding/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: selectedId }),
      })
      const data = await res.json()
      if (res.ok) setMaskedEmail(data.maskedEmail)
    } catch {}
  }

  async function verifyOtp() {
    if (!otpValue || verifyLoading || failCount >= 3) return
    setVerifyLoading(true)
    setOtpError('')
    try {
      const res = await fetch('/api/onboarding/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: selectedId, otp: otpValue }),
      })
      const data = await res.json()
      if (res.ok) {
        router.push(`/onboarding?email=${encodeURIComponent(data.email)}`)
      } else {
        const next = failCount + 1
        setFailCount(next)
        if (next < 3) setOtpError(data.error || 'Invalid code. Try again.')
        setShake(true)
        setTimeout(() => setShake(false), 600)
        setOtpValue('')
      }
    } catch {
      setOtpError('Something went wrong. Try again.')
    } finally {
      setVerifyLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center py-16 px-4">
      <style>{`
        @keyframes otp-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-8px); }
          80% { transform: translateX(8px); }
        }
        .otp-shake { animation: otp-shake 0.5s ease-in-out; }
      `}</style>

      <div className="max-w-sm w-full">
        <div className="flex justify-center mb-10">
          <LogoStacked size={72} />
        </div>

        {/* STATE 1 — Find Account */}
        {state === 'find' && (
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-3">Welcome to REIblast</h1>
            <p className="text-white/50 text-sm leading-relaxed mb-8">
              Just purchased? Let&apos;s find your account to get you started.
            </p>
            {findEmpty && (
              <div className="bg-[#1C1C1C] border border-[#2A2A2A] rounded-xl p-4 text-sm text-white/60 mb-6 text-left leading-relaxed">
                No recent accounts found. It may take a moment to process your
                payment. Try again in 30 seconds.
              </div>
            )}
            <button
              onClick={findAccounts}
              disabled={findLoading}
              className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {findLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Searching...
                </>
              ) : findEmpty ? (
                'Try Again'
              ) : (
                'Find My Account →'
              )}
            </button>
          </div>
        )}

        {/* STATE 2 — Select Account */}
        {state === 'select' && (
          <div>
            <h1 className="text-xl font-bold mb-1">Is this you?</h1>
            <p className="text-white/50 text-sm mb-6">Select your account to continue.</p>
            {sendError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm mb-4">
                Failed to send code. Please try again.
              </div>
            )}
            <div className="space-y-3 mb-6">
              {contacts.map((c) => (
                <div
                  key={c.contactId}
                  className="bg-[#141414] border border-[#2A2A2A] hover:border-gold rounded-xl p-4 flex items-center justify-between gap-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{c.displayName}</p>
                    <p className="text-white/40 text-sm truncate">{c.maskedEmail}</p>
                  </div>
                  <button
                    onClick={() => selectContact(c.contactId)}
                    className="bg-gold text-black font-bold text-sm px-4 py-2 rounded-lg hover:bg-gold-hover transition-colors whitespace-nowrap shrink-0"
                  >
                    That&apos;s me →
                  </button>
                </div>
              ))}
            </div>
            {!showNotSeen ? (
              <button
                onClick={() => setShowNotSeen(true)}
                className="text-white/40 text-sm hover:text-white/70 transition-colors underline underline-offset-2 w-full text-center"
              >
                Don&apos;t see yourself?
              </button>
            ) : (
              <div className="bg-[#1C1C1C] border border-[#2A2A2A] rounded-xl p-4 text-sm text-white/60 text-center">
                <p className="mb-3 leading-relaxed">
                  Your account may still be processing. Wait 60 seconds and try
                  again, or check your email for a welcome message.
                </p>
                <button
                  onClick={() => {
                    setState('find')
                    setShowNotSeen(false)
                    setContacts([])
                    setFindEmpty(false)
                  }}
                  className="text-gold text-sm font-semibold hover:underline"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* STATE 3 — Authorizing */}
        {state === 'authorizing' && (
          <div className="text-center">
            <div className="w-16 h-16 border-2 border-gold border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <h2 className="text-xl font-bold mb-2">Authorizing...</h2>
            <p className="text-white/50 text-sm">Sending your verification code</p>
          </div>
        )}

        {/* STATE 4 — OTP Entry */}
        {state === 'otp' && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">Check your email</h2>
            <p className="text-white/50 text-sm mb-8">
              We sent a 6-digit code to{' '}
              <span className="text-white font-medium">{maskedEmail}</span>
            </p>

            {failCount >= 3 ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-red-400 text-sm leading-relaxed">
                Too many attempts. Contact{' '}
                <a
                  href="mailto:support@reiblast.app"
                  className="underline hover:text-red-300"
                >
                  support@reiblast.app
                </a>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]*"
                  value={otpValue}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                    setOtpValue(v)
                    setOtpError('')
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') verifyOtp()
                  }}
                  className={`w-full text-center text-4xl font-bold bg-[#1C1C1C] border-2 rounded-xl px-4 py-5 outline-none transition-colors mb-2 ${
                    shake ? 'otp-shake' : ''
                  } ${
                    otpError
                      ? 'border-red-500 text-red-400'
                      : 'border-[#2A2A2A] focus:border-gold text-white'
                  }`}
                  style={{ letterSpacing: '0.5em' }}
                  placeholder="——————"
                  disabled={verifyLoading}
                  autoFocus
                />
                {otpError && (
                  <p className="text-red-400 text-sm mb-2">{otpError}</p>
                )}

                <button
                  onClick={verifyOtp}
                  disabled={otpValue.length < 6 || verifyLoading}
                  className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2 mt-3"
                >
                  {verifyLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify →'
                  )}
                </button>

                <div className="mt-6 flex flex-col gap-3">
                  <button
                    onClick={resendOtp}
                    disabled={cooldown > 0}
                    className="text-sm text-white/40 hover:text-white/70 transition-colors disabled:hover:text-white/40 disabled:cursor-default"
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                  </button>
                  <button
                    onClick={() => {
                      setState('find')
                      setOtpValue('')
                      setOtpError('')
                      setFailCount(0)
                      setContacts([])
                    }}
                    className="text-sm text-white/30 hover:text-white/50 transition-colors"
                  >
                    Wrong account?
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function OnboardingContent() {
  const params = useSearchParams()
  const router = useRouter()

  const rawEmail = params.get('email') || ''
  const email =
    rawEmail.includes('{{') || !rawEmail.includes('@') ? '' : rawEmail.toLowerCase()

  const [gateState, setGateState] = useState<GateState>('checking')
  const [step, setStep] = useState(1)
  const [einError, setEinError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0])
  const [msgIndex, setMsgIndex] = useState(0)

  const [fields, setFields] = useState<Step1Fields>({
    email,
    legalBusinessName: '',
    ein: '',
    businessType: 'LLC',
    businessAddress: '',
    businessCity: '',
    businessState: 'TX',
    businessZip: '',
    businessPhone: '',
    businessEmail: '',
    websiteUrl: '',
    targetMarket: '',
  })

  const [compliance, setCompliance] = useState({
    check1: false,
    check2: false,
    check3: false,
  })

  useEffect(() => {
    if (!email) return
    fetch(`/api/onboarding/status?email=${encodeURIComponent(email)}`)
      .then(async (res) => {
        if (res.status === 404) { setGateState('not_found'); return }
        if (!res.ok) { setGateState('not_found'); return }
        const data = await res.json()
        const s: string = data.status
        if (s === 'active') setGateState('active')
        else if (s === 'onboarding_complete' || s === 'provisioning') setGateState('onboarding_complete')
        else setGateState('pending_onboarding')
      })
      .catch(() => setGateState('not_found'))
  }, [email])

  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setMsgIndex((i) => {
        const next = (i + 1) % LOADING_MESSAGES.length
        setLoadingMsg(LOADING_MESSAGES[next])
        return next
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [loading])

  function setField(key: keyof Step1Fields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [key]: e.target.value }))
  }

  function validateStep1() {
    const required: (keyof Step1Fields)[] = [
      'legalBusinessName', 'ein', 'businessType', 'businessAddress',
      'businessCity', 'businessState', 'businessZip', 'businessPhone',
      'businessEmail', 'targetMarket',
    ]
    return required.every((k) => fields[k].trim() !== '')
  }

  function handleEinBlur() {
    if (fields.ein && !/^\d{2}-\d{7}$/.test(fields.ein)) {
      setEinError('EIN must be in format XX-XXXXXXX')
    } else {
      setEinError('')
    }
  }

  function advanceToStep2() {
    if (!validateStep1() || einError) return
    setStep(2)
    window.scrollTo(0, 0)
  }

  function advanceToStep3() {
    setStep(3)
    window.scrollTo(0, 0)
  }

  async function handleSubmit() {
    setSubmitError('')
    setLoading(true)
    setLoadingMsg(LOADING_MESSAGES[0])
    setMsgIndex(0)

    try {
      const res = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, smsComplianceAgreed: true }),
      })

      if (res.ok) {
        router.push('/onboarding/success')
      } else {
        const data = await res.json()
        setSubmitError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
      }
    } catch {
      setSubmitError('Network error. Please try again.')
      setLoading(false)
    }
  }

  // No valid email — show verification flow
  if (!email) return <VerificationFlow />

  const inputClass = 'bg-[#1C1C1C] border-[#2A2A2A] text-white focus:border-gold'

  if (gateState === 'checking') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (gateState === 'not_found') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center py-16 px-4">
        <div className="max-w-md w-full">
          <div className="flex justify-center mb-8"><LogoStacked size={72} /></div>
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-8 text-center">
            <h2 className="text-white font-semibold text-lg mb-3">Your payment is still processing</h2>
            <p className="text-white/60 text-sm leading-relaxed mb-6">
              This usually takes less than a minute. Please refresh the page or check your welcome email for the setup link.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-gold text-black font-bold px-6 py-3 rounded-xl hover:bg-gold-hover transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (gateState === 'active') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center py-16 px-4">
        <div className="max-w-md w-full">
          <div className="flex justify-center mb-8"><LogoStacked size={72} /></div>
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-gold/10 border-2 border-gold flex items-center justify-center mx-auto mb-6">
              <svg className="w-7 h-7 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-white font-bold text-xl mb-6">Your account is already set up!</h2>
            <a
              href={GHL_APP_URL}
              className="block w-full bg-gold text-black font-bold text-lg py-4 rounded-xl hover:bg-gold-hover transition-colors"
            >
              Go to My CRM →
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (gateState === 'onboarding_complete') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center py-16 px-4">
        <div className="max-w-md w-full">
          <div className="flex justify-center mb-8"><LogoStacked size={72} /></div>
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-8 text-center">
            <h2 className="text-white font-bold text-xl mb-3">Your information has been submitted</h2>
            <p className="text-white/60 text-sm leading-relaxed">
              Your information has been submitted and is being reviewed. You&apos;ll receive an email with your login credentials within 24 hours.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // gateState === 'pending_onboarding' — full form
  return (
    <div className="min-h-screen bg-black text-white py-12 px-4">
      <div className="max-w-xl mx-auto">
        <div className="flex justify-center mb-8">
          <LogoStacked size={72} />
        </div>

        <h1 className="text-2xl font-bold text-center mb-2">Set Up Your Account</h1>
        <p className="text-white/40 text-center text-sm mb-8">Complete your business info to get your REIblast workspace.</p>

        <StepIndicator step={step} />

        {/* Step 1 — Business Info */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-white/60 mb-1 block">Email</label>
              <input
                type="email"
                value={fields.email}
                readOnly
                className={`w-full rounded-lg border px-4 py-3 outline-none opacity-50 cursor-not-allowed ${inputClass}`}
              />
            </div>
            <Input label="Legal Business Name" type="text" required placeholder="Acme Properties LLC" value={fields.legalBusinessName} onChange={setField('legalBusinessName')} />
            <div>
              <Input
                label="EIN"
                type="text"
                required
                placeholder="XX-XXXXXXX"
                value={fields.ein}
                onChange={setField('ein')}
                onBlur={handleEinBlur}
                error={einError}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-white/80">Business Type</label>
              <select
                value={fields.businessType}
                onChange={setField('businessType')}
                className="bg-[#1C1C1C] text-white rounded-lg border border-[#2A2A2A] focus:border-gold px-4 py-3 outline-none transition-colors"
              >
                {BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <Input label="Business Address" type="text" required placeholder="123 Main St" value={fields.businessAddress} onChange={setField('businessAddress')} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="City" type="text" required value={fields.businessCity} onChange={setField('businessCity')} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-white/80">State</label>
                <select
                  value={fields.businessState}
                  onChange={setField('businessState')}
                  className="bg-[#1C1C1C] text-white rounded-lg border border-[#2A2A2A] focus:border-gold px-4 py-3 outline-none transition-colors"
                >
                  {US_STATES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <Input label="Zip Code" type="text" required value={fields.businessZip} onChange={setField('businessZip')} />
            <Input label="Business Phone" type="tel" required value={fields.businessPhone} onChange={setField('businessPhone')} />
            <Input label="Business Email" type="email" required value={fields.businessEmail} onChange={setField('businessEmail')} />
            <Input label="Website URL" type="url" placeholder="Leave blank if you don't have one yet" value={fields.websiteUrl} onChange={setField('websiteUrl')} />
            <Input label="Target Market" type="text" required placeholder="e.g. Tampa FL, Phoenix AZ" value={fields.targetMarket} onChange={setField('targetMarket')} />

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-2"
              onClick={advanceToStep2}
              disabled={!validateStep1() || !!einError}
            >
              Continue →
            </Button>
          </div>
        )}

        {/* Step 2 — SMS Compliance */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm text-white/60 block mb-2">
                This description will be used for your A2P SMS registration
              </label>
              <textarea
                rows={4}
                defaultValue="We are a real estate investment company that purchases properties directly from motivated sellers. We contact property owners via SMS to inquire about their interest in selling their property."
                className="w-full bg-[#1C1C1C] text-white rounded-lg border border-[#2A2A2A] focus:border-gold px-4 py-3 outline-none transition-colors resize-none placeholder:text-white/30"
              />
            </div>

            <div className="space-y-4">
              {[
                { key: 'check1' as const, text: 'All contacts I message are property owners being contacted about purchasing their property. I am not texting random consumers.' },
                { key: 'check2' as const, text: 'I will honor all STOP opt-out requests immediately and maintain a do-not-contact list.' },
                { key: 'check3' as const, text: 'I understand that misuse of the REIblast SMS system may result in immediate account suspension.' },
              ].map(({ key, text }) => (
                <label key={key} className="flex gap-3 cursor-pointer group">
                  <div className="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={compliance[key]}
                      onChange={(e) => setCompliance((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${compliance[key] ? 'bg-gold border-gold' : 'border-white/20 bg-transparent'}`}>
                      {compliance[key] && (
                        <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <span className="text-sm text-white/70 leading-relaxed">{text}</span>
                </label>
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={advanceToStep3}
              disabled={!compliance.check1 || !compliance.check2 || !compliance.check3}
            >
              Continue →
            </Button>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-6 space-y-3 text-sm">
              <div className="flex justify-between items-center border-b border-[#2A2A2A] pb-3">
                <span className="font-semibold text-white text-base">Account Summary</span>
                <button onClick={() => setStep(1)} className="text-gold text-xs hover:underline">Edit</button>
              </div>
              {[
                ['Email', fields.email],
                ['Business Name', fields.legalBusinessName],
                ['EIN', fields.ein],
                ['Business Type', fields.businessType],
                ['Address', `${fields.businessAddress}, ${fields.businessCity}, ${fields.businessState} ${fields.businessZip}`],
                ['Phone', fields.businessPhone],
                ['Business Email', fields.businessEmail],
                ['Website', fields.websiteUrl || '—'],
                ['Target Market', fields.targetMarket],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-white/40 shrink-0">{label}</span>
                  <span className="text-white text-right break-all">{value}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-[#2A2A2A] pt-3">
                <span className="text-white/40">SMS Compliance</span>
                <span className="text-green-400">✓ Agreed</span>
              </div>
            </div>

            {submitError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {submitError}
              </div>
            )}

            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gold text-sm font-medium">{loadingMsg}</p>
              </div>
            ) : (
              <Button variant="primary" size="lg" className="w-full" onClick={handleSubmit}>
                Submit My Information
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  )
}
