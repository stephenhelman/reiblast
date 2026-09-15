// Wipe-and-reseed for the REItools engine catalog — locked 2026-09-14
// AUTHORITATIVE PRICING (.claude/docs/REItools-Architecture.md). Bundle-type
// subscriptions are retired: a bundle member is N tool_subs, one per tool,
// at in-bundle prices (BundlePriceOverride). Bundle/BundleTier are
// definition-only — they drive derivation (lib/bundleQualify.ts) and
// display, never a Stripe object or a subscription target.
//
// This wipes the engine catalog + dependent ledger/subscription rows before
// reinserting — the old numbers (à-la-carte ladder, bundle composition,
// debit map) are fully superseded, not just updated in place, so upsert
// would leave stale rows (e.g. the old pack-in-bundle BundleTier line)
// behind. Disposable: DEV BRANCH ONLY.
//
// Tool copy (tagline/hook/category) is placeholder, carried from config/catalog.ts.
// Icon/wordmark paths are the real files listed in lib/brandAssets.ts.
//
// Deliberately does NOT read DATABASE_URL / .env — the target must be named:
//   SEED_DATABASE_URL="<neon dev branch direct url>" npx tsx prisma/seed-catalog.ts
// Separate from prisma/seed.ts, which upserts the admin User.

import { PrismaClient, type Prisma } from '@prisma/client'

const url = process.env.SEED_DATABASE_URL
if (!url) {
  console.error('SEED_DATABASE_URL is not set — refusing to guess a target database.')
  process.exit(1)
}

const prisma = new PrismaClient({ datasourceUrl: url })

type FeatureSeed = Omit<Prisma.FeatureCreateInput, 'tiers' | 'surfaces' | 'ledgerEntries'>

const features = [
  { slug: 'score', bucket: 'core_included', meteringShape: 'per_cycle', creditCost: 5, unitsPerDebit: 1, consumptionEvent: 'one completed analysis' },
  { slug: 'scrub', bucket: 'core_included', meteringShape: 'none', creditCost: 0, unitsPerDebit: 1, consumptionEvent: 'not metered' },
  // Pack: pay-go perk only — no subscription tier. 4 credits ($1.00) / packet
  // from the wallet, always, in or out of a bundle.
  { slug: 'pack', bucket: 'addon', meteringShape: 'per_cycle', creditCost: 4, unitsPerDebit: 1, consumptionEvent: 'one packet created' },
  // Ask corrected to 1 cr / 3 queries (was 1 cr / 5) — see architecture doc
  // §2: at $0.25/credit the old debit made pay-go cheaper than Ask base's
  // in-sub rate, inverting the sub-beats-credits ladder.
  { slug: 'ask', bucket: 'addon', meteringShape: 'per_cycle', creditCost: 1, unitsPerDebit: 3, consumptionEvent: 'one query' },
  { slug: 'bots', bucket: 'addon', meteringShape: 'by_volume', creditCost: 10, unitsPerDebit: 1, consumptionEvent: 'one handoff', unifiedName: 'REIclose' },
] satisfies FeatureSeed[]

type ToolSeed = Omit<Prisma.ToolUncheckedCreateInput, 'featureId' | 'ledgerEntries'> & { featureSlug: string }

// Launch: only score + scrub are active. Bots launches one surface at a time.
const tools = [
  {
    slug: 'score', featureSlug: 'score', name: 'REIscore',
    tagline: 'Placeholder tagline: instant deal scoring.',
    hook: "Placeholder hook: know if it's a deal in seconds.",
    icon: '/brand/icons/rei-score-icon.svg', wordmark: '/brand/wordmarks/rei-score.png',
    category: 'Analysis', unit: 'analyses', active: true, launchable: true, launchTarget: '/rei-score',
  },
  {
    slug: 'scrub', featureSlug: 'scrub', name: 'REIscrub',
    tagline: 'Placeholder tagline: clean lead lists.',
    hook: 'Placeholder hook: dedupe and scrub before you dial.',
    icon: '/brand/icons/rei-scrub-icon.svg', wordmark: '/brand/wordmarks/rei-scrub.png',
    category: 'Leads', unit: 'lookups', active: true, launchable: true, launchTarget: '/rei-scrub',
  },
  {
    slug: 'pack', featureSlug: 'pack', name: 'REIpack',
    tagline: 'Placeholder tagline: buyer list packaging.',
    hook: 'Placeholder hook: package deals for your buyer list fast.',
    icon: '/brand/icons/rei-pack-icon.svg', wordmark: '/brand/wordmarks/rei-pack.png',
    category: 'Dispo', unit: 'packets', active: false, launchable: false, launchTarget: '/rei-pack',
  },
  {
    slug: 'ask', featureSlug: 'ask', name: 'REIask',
    tagline: 'Placeholder tagline: AI deal Q&A.',
    hook: 'Placeholder hook: ask anything about your pipeline.',
    icon: '/brand/icons/rei-ask-icon.svg', wordmark: '/brand/wordmarks/rei-ask.png',
    category: 'AI', unit: 'queries', active: false, launchable: false, launchTarget: '/rei-ask',
  },
  {
    slug: 'acq', featureSlug: 'bots', name: 'REIacq',
    tagline: 'Placeholder tagline: acquisitions pipeline.',
    hook: 'Placeholder hook: manage acquisitions end-to-end.',
    icon: '/brand/icons/rei-acq-icon.svg', wordmark: '/brand/wordmarks/rei-acq.png',
    category: 'Acquisitions', unit: 'handoffs', active: false, launchable: false, launchTarget: '/rei-acq',
  },
  {
    slug: 'dispo', featureSlug: 'bots', name: 'REIdispo',
    tagline: 'Placeholder tagline: dispo automation.',
    hook: 'Placeholder hook: move contracts faster.',
    icon: '/brand/icons/rei-dispo-icon.svg', wordmark: '/brand/wordmarks/rei-dispo.png',
    category: 'Dispo', unit: 'handoffs', active: false, launchable: false, launchTarget: '/rei-dispo',
  },
] satisfies ToolSeed[]

type TierSeed = { featureSlug: string; level: Prisma.TierCreateInput['level']; priceCents: number; allowance: number | null }

// À-la-carte ladder, locked 2026-09-14. No ask/pro — deferred pending a real
// feature hook (architecture doc §3/§8.1). No pack tier — pay-go only.
const tiers = [
  { featureSlug: 'score', level: 'base', priceCents: 0, allowance: 10 },
  { featureSlug: 'score', level: 'plus', priceCents: 2900, allowance: 50 },
  { featureSlug: 'score', level: 'pro', priceCents: 4900, allowance: 175 },
  { featureSlug: 'scrub', level: 'base', priceCents: 0, allowance: null },
  { featureSlug: 'ask', level: 'base', priceCents: 2900, allowance: 500 },
  { featureSlug: 'ask', level: 'plus', priceCents: 4900, allowance: 1500 },
  { featureSlug: 'bots', level: 'base', priceCents: 9900, allowance: 60 },
  { featureSlug: 'bots', level: 'plus', priceCents: 16900, allowance: 120 },
  { featureSlug: 'bots', level: 'pro', priceCents: 29900, allowance: 250 },
] satisfies TierSeed[]

type BundleSeed = Omit<Prisma.BundleCreateInput, 'tiers' | 'subscriptions' | 'priceOverrides'> & {
  covers: { featureSlug: string; level: TierSeed['level'] }[]
}

// Composition locked 2026-09-14: Pack is a granted perk, never a bundle
// line, and never affects qualification (lib/bundleQualify.ts). priceCents
// is the display sub-total of the in-bundle lines (the "actual bill").
const bundles = [
  {
    slug: 'bundle-plus', name: 'REItools+', level: 'plus', priceCents: 4600, // $25 + $21
    covers: [
      { featureSlug: 'score', level: 'plus' },
      { featureSlug: 'ask', level: 'base' },
    ],
  },
  {
    slug: 'bundle-pro', name: 'REItools Pro', level: 'pro', priceCents: 17300, // $45 + $39 + $89
    covers: [
      { featureSlug: 'score', level: 'pro' },
      { featureSlug: 'ask', level: 'plus' },
      { featureSlug: 'bots', level: 'base' },
    ],
  },
] satisfies BundleSeed[]

type OverrideSeed = { featureSlug: string; level: TierSeed['level']; bundleSlug: string }

// Sparse: one row only where in-bundle price != à-la-carte (every covered
// line, here — no bundle line currently matches its à-la-carte price).
// stripePriceId stays null until Pass 2 mints the real in-bundle Stripe
// Price; resolver/checkout fall back to the tier's own stripePriceId until
// then.
const overrides = [
  { featureSlug: 'score', level: 'plus', bundleSlug: 'bundle-plus' }, // à-la-carte $29 -> $25
  { featureSlug: 'ask', level: 'base', bundleSlug: 'bundle-plus' },   // à-la-carte $29 -> $21
  { featureSlug: 'score', level: 'pro', bundleSlug: 'bundle-pro' },   // à-la-carte $49 -> $45
  { featureSlug: 'ask', level: 'plus', bundleSlug: 'bundle-pro' },    // à-la-carte $49 -> $39
  { featureSlug: 'bots', level: 'base', bundleSlug: 'bundle-pro' },   // à-la-carte $99 -> $89
] satisfies OverrideSeed[]

const creditPacks = [
  { slug: 'pack-100', credits: 100, priceCents: 1800 },
  { slug: 'pack-250', credits: 250, priceCents: 4000 },
  { slug: 'pack-600', credits: 600, priceCents: 9000 },
] satisfies Omit<Prisma.CreditPackCreateInput, 'fundingEntries'>[]

async function main() {
  await prisma.$transaction(
    async (tx) => {
      // Wipe: dependent-first. LedgerEntry/Subscription are user data, but
      // they FK-restrict onto Feature/Tool/Tier/CreditPack, which this
      // reseed fully replaces — dev is disposable, so clear them too.
      await tx.ledgerEntry.deleteMany({})
      await tx.subscription.deleteMany({})
      await tx.bundlePriceOverride.deleteMany({})
      await tx.bundleTier.deleteMany({})
      await tx.bundle.deleteMany({})
      await tx.tier.deleteMany({})
      await tx.tool.deleteMany({})
      await tx.feature.deleteMany({})
      await tx.creditPack.deleteMany({})

      const featureIds = new Map<string, string>()
      for (const feature of features) {
        const row = await tx.feature.create({ data: feature })
        featureIds.set(row.slug, row.id)
      }
      const featureId = (slug: string) => {
        const id = featureIds.get(slug)
        if (!id) throw new Error(`Unknown feature slug: ${slug}`)
        return id
      }

      for (const { featureSlug, ...tool } of tools) {
        await tx.tool.create({ data: { ...tool, featureId: featureId(featureSlug) } })
      }

      const tierIds = new Map<string, string>()
      for (const { featureSlug, ...tier } of tiers) {
        const row = await tx.tier.create({ data: { ...tier, featureId: featureId(featureSlug) } })
        tierIds.set(`${featureSlug}/${tier.level}`, row.id)
      }

      for (const { covers, ...bundle } of bundles) {
        const row = await tx.bundle.create({ data: bundle })
        for (const cover of covers) {
          const tierId = tierIds.get(`${cover.featureSlug}/${cover.level}`)
          if (!tierId) throw new Error(`Bundle ${bundle.slug} covers unknown tier ${cover.featureSlug}/${cover.level}`)
          await tx.bundleTier.create({ data: { bundleId: row.id, tierId } })
        }
      }

      for (const override of overrides) {
        await tx.bundlePriceOverride.create({
          data: {
            featureId: featureId(override.featureSlug),
            level: override.level,
            bundleSlug: override.bundleSlug,
            stripePriceId: null,
          },
        })
      }

      for (const pack of creditPacks) {
        await tx.creditPack.create({ data: pack })
      }
    },
    { timeout: 30_000 },
  )

  const counts = {
    features: await prisma.feature.count(),
    tools: await prisma.tool.count(),
    activeTools: await prisma.tool.count({ where: { active: true } }),
    tiers: await prisma.tier.count(),
    bundles: await prisma.bundle.count(),
    bundleTiers: await prisma.bundleTier.count(),
    bundlePriceOverrides: await prisma.bundlePriceOverride.count(),
    creditPacks: await prisma.creditPack.count(),
  }
  console.log('Seeded REItools catalog:', counts)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
