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

function HoldingPage() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center py-16 px-4">
      <div className="max-w-sm w-full text-center">
        <div className="flex justify-center mb-10">
          <LogoStacked size={72} />
        </div>

        {/* Animated envelope */}
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-full bg-gold/10 border-2 border-gold flex items-center justify-center animate-pulse">
            <svg
              className="w-9 h-9 text-gold"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-4">Check Your Email</h1>
        <p className="text-white/60 text-sm leading-relaxed mb-6">
          We sent your onboarding link to the email you used at checkout. Click the link in that
          email to complete your account setup.
        </p>
        <p className="text-white/30 text-xs leading-relaxed">
          Didn&apos;t receive it? Check your spam folder or contact{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-white/50 hover:text-gold transition-colors underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
        </p>
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

  // No valid email — show holding page
  if (!email) return <HoldingPage />

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
