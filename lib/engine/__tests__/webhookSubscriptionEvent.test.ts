import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { handleSubscriptionEvent } from '../../stripe/webhookHandlers'
import { resolveStripePriceId } from '../../bundlePricing'
import { getCurrentBundleSlug } from '../../entitlement'
import { createDisposableUser, teardownDisposableUser, testPrisma } from './testDb'

// Minimal fake of the Stripe.Subscription shape handleSubscriptionEvent
// actually reads (metadata.userId, status, items.data[].price.id +
// current_period_start/end). Cast to Stripe.Subscription at the call site —
// this test only exercises the DB-write path, never real Stripe.
function fakeSubscription(params: {
  id: string
  userId: string
  status: Stripe.Subscription.Status
  priceIds: string[]
}): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000)
  const periodEnd = now + 30 * 24 * 60 * 60
  return {
    id: params.id,
    status: params.status,
    metadata: { userId: params.userId },
    items: {
      data: params.priceIds.map((priceId, i) => ({
        id: `si_fake_${i}`,
        price: { id: priceId },
        current_period_start: now,
        current_period_end: periodEnd,
      })),
    },
  } as unknown as Stripe.Subscription
}

describe('handleSubscriptionEvent (webhook, N tool_subs per subscription)', () => {
  let userId: string
  let scoreProPriceId: string
  let askPlusPriceId: string
  let botsBasePriceId: string

  beforeAll(async () => {
    userId = await createDisposableUser()

    const [scorePro, askPlus, botsBase] = await Promise.all([
      testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } }),
      testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'plus' } }),
      testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'bots' }, level: 'base' } }),
    ])
    if (!scorePro.stripePriceId || !askPlus.stripePriceId || !botsBase.stripePriceId) {
      throw new Error('Test fixture requires the 09-14 backfill (prisma/backfill-stripe-prices.ts) to have run against SEED_DATABASE_URL first.')
    }
    scoreProPriceId = scorePro.stripePriceId
    askPlusPriceId = askPlus.stripePriceId
    botsBasePriceId = botsBase.stripePriceId
  })

  afterAll(async () => {
    await teardownDisposableUser(userId)
  })

  it('lands ONE tool_sub row PER recurring item (bundle-pro member: score/pro + ask/plus + bots/base), and getCurrentBundleSlug derives bundle-pro from them', async () => {
    const stripeSubscriptionId = `sub_fake_${userId}`
    const subscription = fakeSubscription({
      id: stripeSubscriptionId,
      userId,
      status: 'active',
      priceIds: [scoreProPriceId, askPlusPriceId, botsBasePriceId],
    })

    await testPrisma.$transaction(async (tx) => {
      await handleSubscriptionEvent(tx as unknown as Prisma.TransactionClient, subscription, 'customer.subscription.created')
    }, { timeout: 20000 })

    const rows = await testPrisma.subscription.findMany({
      where: { stripeSubscriptionId, status: 'active' },
      include: { tier: { include: { feature: true } } },
    })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.status === 'active')).toBe(true)
    const bySlug = Object.fromEntries(rows.map((r) => [r.tier.feature.slug, r.tier.level]))
    expect(bySlug).toEqual({ score: 'pro', ask: 'plus', bots: 'base' })

    const derived = await getCurrentBundleSlug(testPrisma, userId)
    expect(derived).toBe('bundle-pro')
  })

  it('downgrade-orphan: dropping a line on .updated cancels ONLY that row, kept lines stay active', async () => {
    // Own disposable user — reusing the shared one would collide with test
    // 1's still-active score/ask/bots rows on the same partial unique index
    // this exercises (one active tool_sub per user per feature).
    const downgradeUserId = await createDisposableUser()
    try {
      const stripeSubscriptionId = `sub_fake_downgrade_${downgradeUserId}`
      const subscription = fakeSubscription({
        id: stripeSubscriptionId,
        userId: downgradeUserId,
        status: 'active',
        priceIds: [scoreProPriceId, askPlusPriceId, botsBasePriceId],
      })

      await testPrisma.$transaction(async (tx) => {
        await handleSubscriptionEvent(tx as unknown as Prisma.TransactionClient, subscription, 'customer.subscription.created')
      }, { timeout: 20000 })

      // Pro -> Plus downgrade: bots/base line dropped entirely from the item set.
      const downgraded = fakeSubscription({
        id: stripeSubscriptionId,
        userId: downgradeUserId,
        status: 'active',
        priceIds: [scoreProPriceId, askPlusPriceId],
      })

      await testPrisma.$transaction(async (tx) => {
        await handleSubscriptionEvent(tx as unknown as Prisma.TransactionClient, downgraded, 'customer.subscription.updated')
      }, { timeout: 20000 })

      const rows = await testPrisma.subscription.findMany({
        where: { stripeSubscriptionId },
        include: { tier: { include: { feature: true } } },
      })
      expect(rows).toHaveLength(3) // rows kept, never deleted

      const botsRow = rows.find((r) => r.tier.feature.slug === 'bots')
      expect(botsRow?.status).toBe('canceled') // the dropped line

      const keptRows = rows.filter((r) => r.tier.feature.slug !== 'bots')
      expect(keptRows.every((r) => r.status === 'active')).toBe(true) // kept lines untouched, not just re-asserted
    } finally {
      await teardownDisposableUser(downgradeUserId)
    }
  })

  it('duplicate-active-sub: the partial unique index on (userId, featureId) WHERE status=active rejects a second active tool_sub for the same feature', async () => {
    const secondUser = await createDisposableUser()
    try {
      const scoreBase = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'base' } })
      const scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })
      const now = new Date()
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      await testPrisma.subscription.create({
        data: {
          userId: secondUser,
          tierId: scoreBase.id,
          featureId: scoreBase.featureId,
          status: 'active',
          periodStart: now,
          periodEnd,
        },
      })

      await expect(
        testPrisma.subscription.create({
          data: {
            userId: secondUser,
            tierId: scorePlus.id,
            featureId: scorePlus.featureId, // same feature (score) as the row above
            status: 'active',
            periodStart: now,
            periodEnd,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    } finally {
      await teardownDisposableUser(secondUser)
    }
  })

  // §3's own warning: "a single-item test passes even with the bug present."
  // This drives the ADAPTER through real transitions on a MULTI-ITEM bundle
  // subscription (score + ask sharing one stripeSubscriptionId), so a
  // same-feature tier change (score plus -> pro -> plus) actually exercises
  // cancel-before-upsert + the status-agnostic resurrect, the way the v1.5
  // extraction plan (landSubscriptionItem) is required to preserve.
  it('multi-item bundle: in-bundle upgrade then downgrade-back on the SAME feature — no P2002, and downgrade-back RESURRECTS the original row by id (no duplicate)', async () => {
    const bundleUserId = await createDisposableUser()
    try {
      const [scorePlus, scorePro, askBase] = await Promise.all([
        testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } }),
        testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'pro' } }),
        testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'ask' }, level: 'base' } }),
      ])
      if (!scorePlus.stripePriceId || !scorePro.stripePriceId || !askBase.stripePriceId) {
        throw new Error('Test fixture requires the 09-14 backfill (prisma/backfill-stripe-prices.ts) to have run against SEED_DATABASE_URL first.')
      }

      const stripeSubscriptionId = `sub_fake_bundle_${bundleUserId}`

      // Initial land: score/plus + ask/base on one sub (bundle-plus shape).
      const initial = fakeSubscription({
        id: stripeSubscriptionId,
        userId: bundleUserId,
        status: 'active',
        priceIds: [scorePlus.stripePriceId, askBase.stripePriceId],
      })
      await testPrisma.$transaction(async (tx) => {
        await handleSubscriptionEvent(tx as unknown as Prisma.TransactionClient, initial, 'customer.subscription.created')
      }, { timeout: 20000 })

      const scorePlusRow = await testPrisma.subscription.findFirstOrThrow({
        where: { stripeSubscriptionId, tierId: scorePlus.id },
      })
      expect(scorePlusRow.status).toBe('active')

      // (a) In-bundle upgrade: score plus -> pro. Same feature, new tierId —
      // this is the exact shape that trips P2002 if cancel doesn't precede
      // upsert (insert score/pro while score/plus is still active on the
      // same (userId, featureId) slot).
      const upgraded = fakeSubscription({
        id: stripeSubscriptionId,
        userId: bundleUserId,
        status: 'active',
        priceIds: [scorePro.stripePriceId, askBase.stripePriceId],
      })
      await expect(
        testPrisma.$transaction(async (tx) => {
          await handleSubscriptionEvent(tx as unknown as Prisma.TransactionClient, upgraded, 'customer.subscription.updated')
        }, { timeout: 20000 }),
      ).resolves.not.toThrow()

      const afterUpgrade = await testPrisma.subscription.findMany({
        where: { stripeSubscriptionId, tierId: { in: [scorePlus.id, scorePro.id] } },
      })
      const plusAfterUpgrade = afterUpgrade.find((r) => r.tierId === scorePlus.id)
      const proAfterUpgrade = afterUpgrade.find((r) => r.tierId === scorePro.id)
      expect(plusAfterUpgrade?.status).toBe('canceled')
      expect(proAfterUpgrade?.status).toBe('active')

      // (b) Downgrade-BACK: pro -> plus. The plus row already exists
      // (canceled) — this must RESURRECT it by id, not create a duplicate.
      const downgradedBack = fakeSubscription({
        id: stripeSubscriptionId,
        userId: bundleUserId,
        status: 'active',
        priceIds: [scorePlus.stripePriceId, askBase.stripePriceId],
      })
      await expect(
        testPrisma.$transaction(async (tx) => {
          await handleSubscriptionEvent(tx as unknown as Prisma.TransactionClient, downgradedBack, 'customer.subscription.updated')
        }, { timeout: 20000 }),
      ).resolves.not.toThrow()

      const scoreSlotRows = await testPrisma.subscription.findMany({
        where: { stripeSubscriptionId, featureId: scorePlus.featureId },
      })
      // Row count on the (userId, featureId) slot did not grow across the
      // full upgrade -> downgrade-back cycle: still exactly the two tier
      // slots ever touched (plus, pro), never a third duplicate row.
      expect(scoreSlotRows).toHaveLength(2)

      const resurrectedPlus = scoreSlotRows.find((r) => r.tierId === scorePlus.id)
      const proAfterDowngrade = scoreSlotRows.find((r) => r.tierId === scorePro.id)
      expect(resurrectedPlus?.id).toBe(scorePlusRow.id) // same row, updated back — not a new one
      expect(resurrectedPlus?.status).toBe('active')
      expect(proAfterDowngrade?.status).toBe('canceled')

      const askRow = await testPrisma.subscription.findFirstOrThrow({
        where: { stripeSubscriptionId, tierId: askBase.id },
      })
      expect(askRow.status).toBe('active') // untouched line stays active throughout
    } finally {
      await teardownDisposableUser(bundleUserId)
    }
  })
})

describe('resolveStripePriceId (accessor)', () => {
  it('override-else-à-la-carte: returns the BundlePriceOverride Price when bundleSlug matches a row, the Tier\'s own Price otherwise', async () => {
    const scorePlus = await testPrisma.tier.findFirstOrThrow({ where: { feature: { slug: 'score' }, level: 'plus' } })

    const inBundle = await resolveStripePriceId(testPrisma, {
      featureId: scorePlus.featureId,
      level: 'plus',
      bundleSlug: 'bundle-plus',
    })
    const alaCarte = await resolveStripePriceId(testPrisma, {
      featureId: scorePlus.featureId,
      level: 'plus',
      bundleSlug: null,
    })

    expect(inBundle).not.toBeNull()
    expect(alaCarte).not.toBeNull()
    expect(inBundle).not.toBe(alaCarte) // override and à-la-carte are genuinely different Prices
  })
})
