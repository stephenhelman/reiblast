// Backfills stripePriceId onto already-seeded Tier/Bundle/CreditPack rows.
// Separate from prisma/seed-catalog.ts on purpose: this maps environment-
// specific Stripe test-mode Price IDs onto catalog rows, and must not be
// re-asserted every time the catalog shape is reseeded.
//
// Writes ONLY stripePriceId, per row, via a targeted update — never touches
// priceCents/allowance/any other seeded field. Idempotent: re-running with
// the same map is a no-op write.
//
// Deliberately does NOT read DATABASE_URL / .env — the target must be named:
//   SEED_DATABASE_URL="<neon dev branch direct url>" npx tsx prisma/backfill-stripe-prices.ts

import { PrismaClient } from '@prisma/client'

const url = process.env.SEED_DATABASE_URL
if (!url) {
  console.error('SEED_DATABASE_URL is not set — refusing to guess a target database.')
  process.exit(1)
}

const prisma = new PrismaClient({ datasourceUrl: url })

// Natural keys per prisma/seed-catalog.ts: Tiers are keyed (featureSlug, level);
// Bundles and CreditPacks by slug.
type TierKey = { kind: 'tier'; featureSlug: string; level: 'base' | 'plus' | 'pro' }
type BundleKey = { kind: 'bundle'; slug: string }
type CreditPackKey = { kind: 'creditPack'; slug: string }
type RowKey = TierKey | BundleKey | CreditPackKey

const backfill: { key: RowKey; stripePriceId: string }[] = [
  { key: { kind: 'tier', featureSlug: 'score', level: 'plus' }, stripePriceId: 'price_1UF2CCDBmAikSXyuZR0LgjSX' },
  { key: { kind: 'tier', featureSlug: 'score', level: 'pro' }, stripePriceId: 'price_1UF2CVDBmAikSXyuYzLJTk5n' },
  { key: { kind: 'tier', featureSlug: 'ask', level: 'base' }, stripePriceId: 'price_1UF2CsDBmAikSXyuNC3JrJQD' },
  { key: { kind: 'tier', featureSlug: 'pack', level: 'base' }, stripePriceId: 'price_1UF2DUDBmAikSXyui9Y5bR4C' },
  { key: { kind: 'tier', featureSlug: 'bots', level: 'base' }, stripePriceId: 'price_1UF2EMDBmAikSXyucVTdfJhW' },
  { key: { kind: 'bundle', slug: 'bundle-plus' }, stripePriceId: 'price_1UF2EnDBmAikSXyuKGe6pO6R' },
  { key: { kind: 'bundle', slug: 'bundle-pro' }, stripePriceId: 'price_1UF2F7DBmAikSXyu1yKcGMBo' },
  { key: { kind: 'creditPack', slug: 'pack-100' }, stripePriceId: 'price_1UF2FODBmAikSXyuD2QLT5rs' },
  { key: { kind: 'creditPack', slug: 'pack-250' }, stripePriceId: 'price_1UF2FhDBmAikSXyuWKrnuueE' },
  { key: { kind: 'creditPack', slug: 'pack-600' }, stripePriceId: 'price_1UF2FyDBmAikSXyuocduvRd2' },
]

function describeKey(key: RowKey): string {
  switch (key.kind) {
    case 'tier':
      return `Tier(${key.featureSlug}/${key.level})`
    case 'bundle':
      return `Bundle(${key.slug})`
    case 'creditPack':
      return `CreditPack(${key.slug})`
  }
}

function assertNoDuplicatePriceIds(rows: typeof backfill) {
  const seen = new Map<string, RowKey>()
  for (const { key, stripePriceId } of rows) {
    const existing = seen.get(stripePriceId)
    if (existing) {
      throw new Error(
        `Duplicate stripePriceId ${stripePriceId} mapped to both ${describeKey(existing)} and ${describeKey(key)} — check for a copy-paste in the backfill map.`,
      )
    }
    seen.set(stripePriceId, key)
  }
}

async function resolveTierId(featureSlug: string, level: TierKey['level']): Promise<string> {
  const feature = await prisma.feature.findUnique({ where: { slug: featureSlug } })
  if (!feature) throw new Error(`Unknown feature slug: ${featureSlug} (Tier(${featureSlug}/${level}) does not resolve — orphan Price with nowhere to land)`)
  const tier = await prisma.tier.findUnique({ where: { featureId_level: { featureId: feature.id, level } } })
  if (!tier) throw new Error(`No seeded Tier for (${featureSlug}, ${level}) — orphan Price with nowhere to land`)
  return tier.id
}

async function resolveBundleId(slug: string): Promise<string> {
  const bundle = await prisma.bundle.findUnique({ where: { slug } })
  if (!bundle) throw new Error(`No seeded Bundle with slug ${slug} — orphan Price with nowhere to land`)
  return bundle.id
}

async function resolveCreditPackId(slug: string): Promise<string> {
  const pack = await prisma.creditPack.findUnique({ where: { slug } })
  if (!pack) throw new Error(`No seeded CreditPack with slug ${slug} — orphan Price with nowhere to land`)
  return pack.id
}

async function main() {
  assertNoDuplicatePriceIds(backfill)

  // Resolve-all guard: every target row must exist before any write happens.
  const resolved: { key: RowKey; id: string; stripePriceId: string }[] = []
  for (const entry of backfill) {
    const id =
      entry.key.kind === 'tier'
        ? await resolveTierId(entry.key.featureSlug, entry.key.level)
        : entry.key.kind === 'bundle'
          ? await resolveBundleId(entry.key.slug)
          : await resolveCreditPackId(entry.key.slug)
    resolved.push({ key: entry.key, id, stripePriceId: entry.stripePriceId })
  }

  const updated: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const { key, id, stripePriceId } of resolved) {
      if (key.kind === 'tier') {
        await tx.tier.update({ where: { id }, data: { stripePriceId } })
      } else if (key.kind === 'bundle') {
        await tx.bundle.update({ where: { id }, data: { stripePriceId } })
      } else {
        await tx.creditPack.update({ where: { id }, data: { stripePriceId } })
      }
      updated.push(`${describeKey(key)} -> ${stripePriceId}`)
    }
  })

  console.log('Backfilled stripePriceId on:')
  for (const line of updated) console.log(`  ${line}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
