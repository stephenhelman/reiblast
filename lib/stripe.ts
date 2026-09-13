import Stripe from 'stripe'

function getSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return key
}

// Pinned to the version this installed SDK (stripe@22.6.2) ships as its
// TypeScript-typed default — do not bump without upgrading the package.
export const stripe = new Stripe(getSecretKey(), {
  apiVersion: '2026-08-26.dahlia',
})
