// One-time (idempotent by intent, not by code — see NOTE) creator for the
// 2026-09-14 AUTHORITATIVE PRICING Stripe Price set. Separate from
// prisma/backfill-stripe-prices.ts on purpose: that script writes Price IDs
// onto catalog rows; this script MINTS the Price IDs in Stripe itself. Run
// this first, then hand the printed IDs to backfill-stripe-prices.ts.
//
// TEST MODE ONLY — refuses to run against a key that isn't sk_test_.
//
// NOTE: not re-run-safe (Stripe Prices are immutable; re-running this would
// mint duplicates). If the price set needs to change, deactivate the old
// Prices in the Stripe dashboard/API and re-run by hand, editing the plan
// below first.
//
// Usage:
//   STRIPE_SECRET_KEY="sk_test_..." npx tsx prisma/create-stripe-prices.ts

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.')
  process.exit(1)
}
if (!key.startsWith('sk_test_')) {
  console.error(`STRIPE_SECRET_KEY does not look like a test-mode key (expected sk_test_ prefix, got "${key.slice(0, 8)}...") — refusing to create live Prices from this script.`)
  process.exit(1)
}

const stripe = new Stripe(key, { apiVersion: '2026-08-26.dahlia' })

// Existing test-mode products worth reusing (from the 2026-09-11-era catalog) —
// confirmed via `stripe.products.list` before writing this plan.
const EXISTING_PRODUCTS = {
  scorePlus: 'prod_VFXGIopAOmuD1X', // "REIscore Plus"
  scorePro: 'prod_VFXHMoomVMDCXe', // "REIScore Pro"
  askBase: 'prod_VFXHiHomVzwD0c', // "REIask"
  closeBase: 'prod_VFXI8JDZW661IR', // "REIclose"
} as const

// Products with no 09-14 replacement — retired outright by deactivating the
// PRODUCT (a Price can't be archived while it's still its product's default,
// and these have no new Price coming to take over that slot).
const PRODUCTS_TO_DEACTIVATE = [
  'prod_VFXJzzgSE88dP1', // REItools Plus (flat bundle-plus Price, $49) — retired model, Bundle carries no Price now
  'prod_VFXJ010MF2Zw8K', // REItools Pro (flat bundle-pro Price, $149) — retired model
]

// à-la-carte Prices being superseded by new 09-14 amounts. Each is the
// default_price of a product we're REUSING below — deactivated only after
// the new Price is created and promoted to default (see main()).
const SUPERSEDED_PRICE_TO_PRODUCT: Record<string, string> = {
  price_1UF2CCDBmAikSXyuZR0LgjSX: EXISTING_PRODUCTS.scorePlus, // old $25 -> superseded by $29
  price_1UF2CVDBmAikSXyuYzLJTk5n: EXISTING_PRODUCTS.scorePro, // old $69 -> superseded by $49
  price_1UF2CsDBmAikSXyuNC3JrJQD: EXISTING_PRODUCTS.askBase, // old $15 -> superseded by $29
  price_1UF2EMDBmAikSXyucVTdfJhW: EXISTING_PRODUCTS.closeBase, // old $79 -> superseded by $99
}

type PlanEntry = {
  key: string // matches backfill-stripe-prices.ts's RowKey/override description
  productId?: string // reuse an existing product
  newProductName?: string // or create one
  nickname: string
  unitAmountCents: number
}

const plan: PlanEntry[] = [
  // À-la-carte ladder
  { key: 'tier:score/plus', productId: EXISTING_PRODUCTS.scorePlus, nickname: 'score/plus à la carte', unitAmountCents: 2900 },
  { key: 'tier:score/pro', productId: EXISTING_PRODUCTS.scorePro, nickname: 'score/pro à la carte', unitAmountCents: 4900 },
  { key: 'tier:ask/base', productId: EXISTING_PRODUCTS.askBase, nickname: 'ask/base à la carte', unitAmountCents: 2900 },
  { key: 'tier:ask/plus', newProductName: 'REIask Plus', nickname: 'ask/plus à la carte', unitAmountCents: 4900 },
  { key: 'tier:bots/base', productId: EXISTING_PRODUCTS.closeBase, nickname: 'close(bots)/base à la carte', unitAmountCents: 9900 },
  { key: 'tier:bots/plus', newProductName: 'REIclose Plus', nickname: 'close(bots)/plus à la carte', unitAmountCents: 16900 },
  { key: 'tier:bots/pro', newProductName: 'REIclose Pro', nickname: 'close(bots)/pro à la carte', unitAmountCents: 29900 },
  // In-bundle overrides — same product as the à-la-carte line, distinct Price.
  { key: 'override:score/plus·bundle-plus', productId: EXISTING_PRODUCTS.scorePlus, nickname: 'score/plus in bundle-plus', unitAmountCents: 2500 },
  { key: 'override:ask/base·bundle-plus', productId: EXISTING_PRODUCTS.askBase, nickname: 'ask/base in bundle-plus', unitAmountCents: 2100 },
  { key: 'override:score/pro·bundle-pro', productId: EXISTING_PRODUCTS.scorePro, nickname: 'score/pro in bundle-pro', unitAmountCents: 4500 },
  { key: 'override:ask/plus·bundle-pro', newProductName: 'REIask Plus', nickname: 'ask/plus in bundle-pro', unitAmountCents: 3900 },
  { key: 'override:bots/base·bundle-pro', productId: EXISTING_PRODUCTS.closeBase, nickname: 'close(bots)/base in bundle-pro', unitAmountCents: 8900 },
]

async function main() {
  const newProductIds = new Map<string, string>()
  const results: { key: string; priceId: string }[] = []
  // à-la-carte lines that reuse an existing product need their new Price
  // promoted to default_price before the old one can be archived (Stripe
  // refuses to archive a product's current default_price).
  const promotedDefaultFor = new Set<string>()

  for (const entry of plan) {
    let productId = entry.productId
    if (!productId && entry.newProductName) {
      productId = newProductIds.get(entry.newProductName)
      if (!productId) {
        const product = await stripe.products.create({ name: entry.newProductName })
        productId = product.id
        newProductIds.set(entry.newProductName, productId)
        console.log(`Created product ${entry.newProductName} -> ${productId}`)
      }
    }
    if (!productId) throw new Error(`Plan entry ${entry.key} has neither productId nor newProductName`)

    const price = await stripe.prices.create({
      product: productId,
      currency: 'usd',
      unit_amount: entry.unitAmountCents,
      recurring: { interval: 'month' },
      nickname: entry.nickname,
    })
    results.push({ key: entry.key, priceId: price.id })
    console.log(`  ${entry.key} -> ${price.id} ($${(entry.unitAmountCents / 100).toFixed(2)}/mo, ${entry.nickname})`)

    // Only the à-la-carte entry (not the in-bundle override on the same
    // product) should become the product's default_price.
    if (entry.key.startsWith('tier:') && entry.productId && !promotedDefaultFor.has(productId)) {
      await stripe.products.update(productId, { default_price: price.id })
      promotedDefaultFor.add(productId)
      console.log(`  promoted ${price.id} to default_price of ${productId}`)
    }
  }

  console.log(`\nDeactivating ${Object.keys(SUPERSEDED_PRICE_TO_PRODUCT).length} superseded à-la-carte Prices...`)
  for (const priceId of Object.keys(SUPERSEDED_PRICE_TO_PRODUCT)) {
    await stripe.prices.update(priceId, { active: false })
    console.log(`  deactivated ${priceId}`)
  }

  console.log(`\nDeactivating ${PRODUCTS_TO_DEACTIVATE.length} retired products (flat bundle Prices, no 09-14 replacement)...`)
  for (const productId of PRODUCTS_TO_DEACTIVATE) {
    await stripe.products.update(productId, { active: false })
    console.log(`  deactivated product ${productId}`)
  }

  console.log('\nDone. Paste these into prisma/backfill-stripe-prices.ts:\n')
  console.log(JSON.stringify(results, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
