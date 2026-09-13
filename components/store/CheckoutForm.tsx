'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadStripe, type Stripe, type StripeCheckoutElementsSdk, type StripeCheckoutSession } from '@stripe/stripe-js'
import { portalBrand } from '@/lib/brandAssets'

let stripePromise: Promise<Stripe | null> | null = null
function getStripe(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

// theme: 'night' as the base plus our brand variables — recomputed fresh per
// mount rather than a module-level constant, so a future light/dark toggle
// only has to change what's passed in here, not how it's wired up.
function buildAppearance(mode: 'dark' | 'light' = 'dark') {
  return {
    theme: mode === 'dark' ? ('night' as const) : ('stripe' as const),
    variables: {
      colorPrimary: '#F5C842',
      colorBackground: mode === 'dark' ? '#141414' : '#ffffff',
      colorText: mode === 'dark' ? '#ffffff' : '#0A0A0A',
      colorTextSecondary: '#C0C0C0',
      colorTextPlaceholder: '#888888',
      colorDanger: '#f0464b',
      borderRadius: '10px',
      fontFamily: 'Inter, sans-serif',
    },
  }
}

interface CheckoutFormProps {
  publishableKey: string
  clientSecret: string
  onClose: () => void
}

export default function CheckoutForm({ publishableKey, clientSecret, onClose }: CheckoutFormProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sdkRef = useRef<StripeCheckoutElementsSdk | null>(null)
  const [session, setSession] = useState<StripeCheckoutSession | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getStripe(publishableKey).then((stripe) => {
      if (!stripe || cancelled || !containerRef.current) return
      const sdk = stripe.initCheckoutElementsSdk({
        clientSecret,
        elementsOptions: { appearance: buildAppearance('dark') },
      })
      sdkRef.current = sdk
      sdk.on('change', (nextSession) => {
        if (!cancelled) setSession(nextSession)
      })

      sdk.loadActions().then((result) => {
        if (result.type === 'success') {
          setSession(result.actions.getSession())
        }
      })

      const paymentElement = sdk.createPaymentElement()
      paymentElement.mount(containerRef.current)
    })

    return () => {
      cancelled = true
      sdkRef.current = null
    }
  }, [publishableKey, clientSecret])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleConfirm = async () => {
    const sdk = sdkRef.current
    if (!sdk) return
    setConfirming(true)
    setError(null)

    const actionsResult = await sdk.loadActions()
    if (actionsResult.type === 'error') {
      setError(actionsResult.error.message)
      setConfirming(false)
      return
    }

    // Don't pass `returnUrl` here — the Checkout Session already carries a
    // `return_url` (set server-side in mintCheckout), and confirm() rejects
    // with "You cannot provide `returnUrl` to confirm() when `return_url`
    // was already provided when creating the Checkout Session" if both are
    // set. Stripe redirects to that URL itself for flows that require it
    // (e.g. 3DS); we only need to handle the non-redirect completion case.
    const result = await actionsResult.actions.confirm()
    setConfirming(false)
    if (result.type === 'error') {
      setError(result.error.message)
      return
    }
    if (result.session.status.type === 'complete') {
      window.location.href = `${window.location.origin}/tools/store?checkout=complete`
    }
  }

  // Each line item carries its own Product image (session.lineItems[].images)
  // — set to the tool's wordmark in Stripe's dashboard, so no client-side
  // name/price-id matching is needed. Falls back to the umbrella mark for
  // anything without an image configured (e.g. a Product not yet updated).
  const lineItems = (session?.lineItems ?? []).map((item) => ({
    item,
    wordmark: item.images[0] ?? portalBrand.wordmark,
  }))
  const total = session?.total.total.amount

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-surface p-4">
        <button
          onClick={onClose}
          aria-label="Close checkout"
          className="absolute right-3 top-3 z-10 text-silver hover:text-white text-2xl leading-none px-1.5"
        >
          ×
        </button>

        {/*
          Our own header, not Stripe's — under ui_mode: 'elements' Stripe
          renders no page chrome of its own (we build the whole form), and
          branding_settings.display_name (the old business-name override) is
          rejected outright for this ui_mode. Text Stripe itself injects
          (Link's "continue to X", wallet consent screens, 3DS) still reads
          the Stripe account's own Business Profile name and can't be
          overridden per-session — that's a Dashboard setting, not code.
        */}
        <div className="flex items-center gap-2 mb-4 pr-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={portalBrand.wordmark} alt="REItools" style={{ height: 18, width: 'auto' }} />
          <span className="text-[11.5px] text-gray">powered by OP Web Studio</span>
        </div>

        {lineItems.length > 0 && (
          <div className="mb-4 rounded-lg border border-border-default bg-black px-4 py-3">
            {lineItems.map(({ item, wordmark }) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm text-silver py-1.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- unknown intrinsic size from Stripe, next/image would need it upfront */}
                  <img src={wordmark} alt="" style={{ height: 16, width: 'auto' }} />
                  <span className="truncate">{item.name}</span>
                </div>
                <span className="shrink-0">{item.total.amount}</span>
              </div>
            ))}
            {total && (
              <div className="flex justify-between font-semibold text-white pt-2 mt-2 border-t border-border-default">
                <span>Total</span>
                <span>{total}</span>
              </div>
            )}
          </div>
        )}

        <div ref={containerRef} />

        {error && <p className="text-[12.5px] text-red mt-3">{error}</p>}

        <button
          onClick={handleConfirm}
          disabled={confirming || !session?.canConfirm}
          className="w-full mt-4 rounded-lg bg-gold hover:bg-gold-hover disabled:opacity-50 text-black font-semibold py-2.5"
        >
          {confirming ? 'Confirming…' : 'Pay now'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
