'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { loadStripe, type Stripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js'

let stripePromise: Promise<Stripe | null> | null = null
function getStripe(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

interface EmbeddedCheckoutProps {
  publishableKey: string
  clientSecret: string
  onClose: () => void
}

export default function EmbeddedCheckout({ publishableKey, clientSecret, onClose }: EmbeddedCheckoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<StripeEmbeddedCheckout | null>(null)

  useEffect(() => {
    let cancelled = false

    getStripe(publishableKey).then((stripe) => {
      if (!stripe || cancelled || !containerRef.current) return
      stripe.createEmbeddedCheckoutPage({ clientSecret }).then((embeddedCheckout) => {
        if (cancelled) {
          embeddedCheckout.destroy()
          return
        }
        instanceRef.current = embeddedCheckout
        embeddedCheckout.mount(containerRef.current!)
      })
    })

    return () => {
      cancelled = true
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
  }, [publishableKey, clientSecret])

  // Own Escape handling — this modal is portaled out from under any parent
  // (e.g. the cart drawer) whose own Escape listener would otherwise fire too.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Portaled to document.body: a parent with an active CSS transform/animation
  // (e.g. the cart drawer's slide-in animation) would otherwise create a new
  // containing block and trap this fixed-position overlay inside the parent's
  // box instead of covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-white p-4">
        <button
          onClick={onClose}
          aria-label="Close checkout"
          className="absolute right-3 top-3 z-10 text-black/60 hover:text-black text-2xl leading-none px-1.5"
        >
          ×
        </button>
        <div ref={containerRef} />
      </div>
    </div>,
    document.body,
  )
}
