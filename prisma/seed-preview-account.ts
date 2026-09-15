// One-off DEV-ONLY script: seeds a real, active User (+ Wallet, Subscriptions,
// LedgerEntry rows) into the dev DB so the account/wallet page can be previewed
// through the REAL code path (no OTP, no TOOLS_PREVIEW_MOCK_MEMBER fallback —
// middleware.ts requires a genuinely signed session cookie for every tools
// route, so the mock-member fallback inside getAccountData() is unreachable
// from a browser). Mints a session token for that user directly via
// signToolsSession() and prints the cookie to paste into devtools.
//
// Requires prisma/seed-catalog.ts to have already been run against the same
// target DB (score/ask/pack/bots features, tiers, pack-250 must exist).
//
// Usage:
//   npx tsx prisma/seed-preview-account.ts
//
// Reads SEED_DATABASE_URL (dev DB) and TOOLS_SESSION_SECRET from .env/.env.local.

import dotenv from 'dotenv'
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

import { PrismaClient } from '@prisma/client'
import { signToolsSession } from '../lib/toolsSession'
import { TOOLS_SESSION_COOKIE } from '../lib/constants'

const url = process.env.SEED_DATABASE_URL
if (!url) {
  console.error('SEED_DATABASE_URL is not set — refusing to guess a target database.')
  process.exit(1)
}

const prisma = new PrismaClient({ datasourceUrl: url })

const PREVIEW_EMAIL = 'preview-account@reiblast.local'
const PREVIEW_LOCATION_ID = 'preview-account-location'

async function main() {
  const [scoreFeature, askFeature, packFeature, botsFeature] = await Promise.all([
    prisma.feature.findUniqueOrThrow({ where: { slug: 'score' } }).catch(() => {
      throw new Error('Feature "score" not found — run `npx tsx prisma/seed-catalog.ts` against SEED_DATABASE_URL first.')
    }),
    prisma.feature.findUniqueOrThrow({ where: { slug: 'ask' } }),
    prisma.feature.findUniqueOrThrow({ where: { slug: 'pack' } }),
    prisma.feature.findUniqueOrThrow({ where: { slug: 'bots' } }),
  ])

  const [scoreTool, askTool, packTool, acqTool] = await Promise.all([
    prisma.tool.findUniqueOrThrow({ where: { slug: 'score' } }),
    prisma.tool.findUniqueOrThrow({ where: { slug: 'ask' } }),
    prisma.tool.findUniqueOrThrow({ where: { slug: 'pack' } }),
    prisma.tool.findUniqueOrThrow({ where: { slug: 'acq' } }),
  ])

  const scorePlusTier = await prisma.tier.findUniqueOrThrow({
    where: { featureId_level: { featureId: scoreFeature.id, level: 'plus' } },
  })
  // Bundle Plus member preview: N tool_subs, not a bundle-type row (retired
  // — see lib/bundleQualify.ts). score/plus is seeded active above; ask/base
  // here, past_due, so the account page shows a real dunning state on one of
  // the bundle's two lines.
  const askBaseTier = await prisma.tier.findUniqueOrThrow({
    where: { featureId_level: { featureId: askFeature.id, level: 'base' } },
  })
  const pack250 = await prisma.creditPack.findUniqueOrThrow({ where: { slug: 'pack-250' } })

  const user = await prisma.user.upsert({
    where: { email: PREVIEW_EMAIL },
    update: { status: 'active', a2pPhone: '+15555550100', ghlContactId: 'preview-contact' },
    create: {
      email: PREVIEW_EMAIL,
      name: 'Preview Account',
      status: 'active',
      ghlLocationId: PREVIEW_LOCATION_ID,
      ghlContactId: 'preview-contact',
      a2pPhone: '+15555550100',
    },
  })

  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { balance: 246 },
    create: { userId: user.id, balance: 246 },
  })

  const now = new Date()
  const periodStart = new Date(now)
  const periodEndActive = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000)
  const periodEndPastDue = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const periodStartPastDue = new Date(now.getTime() - 33 * 24 * 60 * 60 * 1000)

  // Replace-not-stack: clear any prior preview subs/ledger rows so reruns don't duplicate.
  await prisma.subscription.deleteMany({ where: { userId: user.id } })
  await prisma.ledgerEntry.deleteMany({ where: { userId: user.id } })

  await prisma.subscription.create({
    data: {
      userId: user.id,
      tierId: scorePlusTier.id,
      featureId: scoreFeature.id,
      status: 'active',
      periodStart,
      periodEnd: periodEndActive,
    },
  })

  await prisma.subscription.create({
    data: {
      userId: user.id,
      tierId: askBaseTier.id,
      featureId: askFeature.id,
      status: 'past_due',
      periodStart: periodStartPastDue,
      periodEnd: periodEndPastDue,
    },
  })

  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  await prisma.ledgerEntry.createMany({
    data: [
      {
        userId: user.id,
        kind: 'funding',
        creditDelta: 0,
        reason: 'tier_grant',
        createdAt: daysAgo(28),
      },
      {
        userId: user.id,
        kind: 'consumption',
        creditDelta: 0,
        toolId: scoreTool.id,
        featureId: scoreFeature.id,
        unitCount: 1,
        vendorCostCents: 12,
        creditsDebited: 0,
        allowanceCovered: true,
        outcome: 'success',
        createdAt: daysAgo(25),
      },
      {
        userId: user.id,
        kind: 'funding',
        creditDelta: 250,
        reason: 'pack_purchase',
        creditPackId: pack250.id,
        refId: 'pi_preview_1',
        createdAt: daysAgo(20),
      },
      {
        userId: user.id,
        kind: 'consumption',
        creditDelta: -1,
        toolId: askTool.id,
        featureId: askFeature.id,
        unitCount: 5,
        vendorCostCents: 3,
        creditsDebited: 1,
        allowanceCovered: false,
        outcome: 'success',
        createdAt: daysAgo(14),
      },
      {
        userId: user.id,
        kind: 'consumption',
        creditDelta: 0,
        toolId: acqTool.id,
        featureId: botsFeature.id,
        unitCount: 1,
        vendorCostCents: 0,
        creditsDebited: 0,
        allowanceCovered: false,
        outcome: 'fail',
        createdAt: daysAgo(10),
      },
      {
        userId: user.id,
        kind: 'consumption',
        creditDelta: 0,
        toolId: scoreTool.id,
        featureId: scoreFeature.id,
        unitCount: 1,
        vendorCostCents: 12,
        creditsDebited: 0,
        allowanceCovered: true,
        outcome: 'success',
        createdAt: daysAgo(6),
      },
      {
        userId: user.id,
        kind: 'consumption',
        creditDelta: -3,
        toolId: packTool.id,
        featureId: packFeature.id,
        unitCount: 3,
        vendorCostCents: 9,
        creditsDebited: 3,
        allowanceCovered: false,
        outcome: 'success',
        createdAt: daysAgo(2),
      },
    ],
  })

  const token = await signToolsSession({ userId: user.id, locationId: PREVIEW_LOCATION_ID })

  console.log(`\nSeeded preview user: ${user.email} (id: ${user.id})`)
  console.log('\nSet this cookie in devtools (Application -> Cookies -> http://localhost:3001):')
  console.log(`  name:  ${TOOLS_SESSION_COOKIE}`)
  console.log(`  value: ${token}`)
  console.log('\nThen visit http://localhost:3001/account\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
