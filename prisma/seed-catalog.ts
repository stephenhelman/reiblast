// Rerunnable seed for the REItools engine catalog — grounded launch numbers from
// .claude/rei-tools/REItools-Wallet-Engine-Sprint.md §7. Upserts on natural keys,
// so a rerun re-asserts these values without duplicating rows. Tool.active is
// written on create only: a rerun never undoes a surface activation, which is a
// data change made in the DB.
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
  { slug: 'pack', bucket: 'addon', meteringShape: 'per_cycle', creditCost: 1, unitsPerDebit: 1, consumptionEvent: 'one packet created' },
  { slug: 'ask', bucket: 'addon', meteringShape: 'per_cycle', creditCost: 1, unitsPerDebit: 5, consumptionEvent: 'one query' },
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

const tiers = [
  { featureSlug: 'score', level: 'base', priceCents: 0, allowance: 10 },
  { featureSlug: 'score', level: 'plus', priceCents: 2500, allowance: 50 },
  { featureSlug: 'score', level: 'pro', priceCents: 6900, allowance: 175 },
  { featureSlug: 'scrub', level: 'base', priceCents: 0, allowance: null },
  { featureSlug: 'pack', level: 'base', priceCents: 1900, allowance: 150 },
  { featureSlug: 'ask', level: 'base', priceCents: 1500, allowance: 500 },
  { featureSlug: 'bots', level: 'base', priceCents: 7900, allowance: 60 },
] satisfies TierSeed[]

type BundleSeed = Omit<Prisma.BundleCreateInput, 'tiers' | 'subscriptions'> & {
  covers: { featureSlug: string; level: TierSeed['level'] }[]
}

const bundles = [
  {
    slug: 'bundle-plus', name: 'REItools+', level: 'plus', priceCents: 4900,
    covers: [
      { featureSlug: 'score', level: 'plus' },
      { featureSlug: 'ask', level: 'base' },
      { featureSlug: 'pack', level: 'base' },
    ],
  },
  {
    slug: 'bundle-pro', name: 'REItools Pro', level: 'pro', priceCents: 14900,
    covers: [
      { featureSlug: 'score', level: 'pro' },
      { featureSlug: 'ask', level: 'base' },
      { featureSlug: 'pack', level: 'base' },
      { featureSlug: 'bots', level: 'base' },
    ],
  },
] satisfies BundleSeed[]

const creditPacks = [
  { slug: 'pack-100', credits: 100, priceCents: 1800 },
  { slug: 'pack-250', credits: 250, priceCents: 4000 },
  { slug: 'pack-600', credits: 600, priceCents: 9000 },
] satisfies Omit<Prisma.CreditPackCreateInput, 'fundingEntries'>[]

async function main() {
  await prisma.$transaction(
    async (tx) => {
      const featureIds = new Map<string, string>()
      for (const feature of features) {
        const row = await tx.feature.upsert({ where: { slug: feature.slug }, create: feature, update: feature })
        featureIds.set(row.slug, row.id)
      }
      const featureId = (slug: string) => {
        const id = featureIds.get(slug)
        if (!id) throw new Error(`Unknown feature slug: ${slug}`)
        return id
      }

      for (const { featureSlug, active, ...tool } of tools) {
        const data = { ...tool, featureId: featureId(featureSlug) }
        await tx.tool.upsert({ where: { slug: tool.slug }, create: { ...data, active }, update: data })
      }

      const tierIds = new Map<string, string>()
      for (const { featureSlug, ...tier } of tiers) {
        const where = { featureId_level: { featureId: featureId(featureSlug), level: tier.level } }
        const row = await tx.tier.upsert({
          where,
          create: { ...tier, featureId: featureId(featureSlug) },
          update: { priceCents: tier.priceCents, allowance: tier.allowance },
        })
        tierIds.set(`${featureSlug}/${tier.level}`, row.id)
      }

      for (const { covers, ...bundle } of bundles) {
        const row = await tx.bundle.upsert({ where: { slug: bundle.slug }, create: bundle, update: bundle })
        for (const cover of covers) {
          const tierId = tierIds.get(`${cover.featureSlug}/${cover.level}`)
          if (!tierId) throw new Error(`Bundle ${bundle.slug} covers unknown tier ${cover.featureSlug}/${cover.level}`)
          await tx.bundleTier.upsert({
            where: { bundleId_tierId: { bundleId: row.id, tierId } },
            create: { bundleId: row.id, tierId },
            update: {},
          })
        }
      }

      for (const pack of creditPacks) {
        await tx.creditPack.upsert({ where: { slug: pack.slug }, create: pack, update: pack })
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
    creditPacks: await prisma.creditPack.count(),
  }
  console.log('Seeded REItools catalog:', counts)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
