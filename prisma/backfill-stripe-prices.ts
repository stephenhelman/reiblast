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
// BundlePriceOverride rows by (featureSlug, level, bundleSlug) — a bundle
// itself carries no Price (retired, see lib/bundlePricing.ts); CreditPacks
// by slug. No 'bundle' key anymore — Bundle.stripePriceId is gone.
type TierKey = { kind: 'tier'; featureSlug: string; level: 'base' | 'plus' | 'pro' }
type OverrideKey = { kind: 'override'; featureSlug: string; level: 'base' | 'plus' | 'pro'; bundleSlug: string }
type CreditPackKey = { kind: 'creditPack'; slug: string }
type RowKey = TierKey | OverrideKey | CreditPackKey

// 2026-09-14 AUTHORITATIVE PRICING (.claude/docs/REItools-Architecture.md).
// Minted via prisma/create-stripe-prices.ts (test mode) — see that script's
// output for provenance. No CreditPack Prices here (deferred; SKUs locked
// but Price creation stays deferred until we say). score/base + scrub/base
// stay null (membership-granted, never sold).
const backfill: { key: RowKey; stripePriceId: string }[] = [
  { key: { kind: 'tier', featureSlug: 'score', level: 'plus' }, stripePriceId: 'price_1UFocaDBmAikSXyuOaDqZcfm' },
  { key: { kind: 'tier', featureSlug: 'score', level: 'pro' }, stripePriceId: 'price_1UFocbDBmAikSXyukr5TolrV' },
  { key: { kind: 'tier', featureSlug: 'ask', level: 'base' }, stripePriceId: 'price_1UG3a4DBmAikSXyu5XGUmxof' },
  { key: { kind: 'tier', featureSlug: 'ask', level: 'plus' }, stripePriceId: 'price_1UG4CrDBmAikSXyunaP4EuN3' },
  { key: { kind: 'tier', featureSlug: 'bots', level: 'base' }, stripePriceId: 'price_1UFoceDBmAikSXyugKknohv6' },
  { key: { kind: 'tier', featureSlug: 'bots', level: 'plus' }, stripePriceId: 'price_1UFocfDBmAikSXyu154HjOxv' },
  { key: { kind: 'tier', featureSlug: 'bots', level: 'pro' }, stripePriceId: 'price_1UFocgDBmAikSXyuRvkBpZgt' },
  { key: { kind: 'override', featureSlug: 'score', level: 'plus', bundleSlug: 'bundle-plus' }, stripePriceId: 'price_1UFocgDBmAikSXyu0LVcfHa8' },
  { key: { kind: 'override', featureSlug: 'ask', level: 'base', bundleSlug: 'bundle-plus' }, stripePriceId: 'price_1UG3aVDBmAikSXyuK1yfkxoV' },
  { key: { kind: 'override', featureSlug: 'score', level: 'pro', bundleSlug: 'bundle-pro' }, stripePriceId: 'price_1UFochDBmAikSXyuH7CBxNuY' },
  { key: { kind: 'override', featureSlug: 'ask', level: 'plus', bundleSlug: 'bundle-pro' }, stripePriceId: 'price_1UG3jiDBmAikSXyu4ojDctFz' },
  { key: { kind: 'override', featureSlug: 'bots', level: 'base', bundleSlug: 'bundle-pro' }, stripePriceId: 'price_1UFociDBmAikSXyu9AT35N3j' },
  // 2026-09-15 — 4 in-bundle upgrade-cell overrides (additive, not in the 09-14 locked sheet;
  // confirmed with Stephen before minting). score/pro·bundle-plus $47, ask/plus·bundle-plus $44,
  // bots/plus·bundle-pro $159, bots/pro·bundle-pro $281.
  // Also same-day: the 4 `ask` tier/override rows above were repointed off a drifted, partly-dead
  // Stripe lineage (ask/plus à-la-carte's old Price was `type: one_time`, unusable for a sub) onto
  // the current active `REIask`/`REIask Plus` products; a new recurring $49 ask/plus à-la-carte
  // Price (price_1UG4CrDBmAikSXyunaP4EuN3) was minted since no valid one existed.
  { key: { kind: 'override', featureSlug: 'score', level: 'pro', bundleSlug: 'bundle-plus' }, stripePriceId: 'price_1UG49DDBmAikSXyucNxggOAz' },
  { key: { kind: 'override', featureSlug: 'ask', level: 'plus', bundleSlug: 'bundle-plus' }, stripePriceId: 'price_1UG49EDBmAikSXyuBZgSthW3' },
  { key: { kind: 'override', featureSlug: 'bots', level: 'plus', bundleSlug: 'bundle-pro' }, stripePriceId: 'price_1UG49EDBmAikSXyu2sfBLLkW' },
  { key: { kind: 'override', featureSlug: 'bots', level: 'pro', bundleSlug: 'bundle-pro' }, stripePriceId: 'price_1UG49EDBmAikSXyuaRyKqd94' },
]

function describeKey(key: RowKey): string {
  switch (key.kind) {
    case 'tier':
      return `Tier(${key.featureSlug}/${key.level})`
    case 'override':
      return `BundlePriceOverride(${key.featureSlug}/${key.level}·${key.bundleSlug})`
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

async function resolveOverrideId(featureSlug: string, level: TierKey['level'], bundleSlug: string): Promise<string> {
  const feature = await prisma.feature.findUnique({ where: { slug: featureSlug } })
  if (!feature) throw new Error(`Unknown feature slug: ${featureSlug} (BundlePriceOverride(${featureSlug}/${level}·${bundleSlug}) does not resolve — orphan Price with nowhere to land)`)
  const override = await prisma.bundlePriceOverride.findUnique({
    where: { featureId_level_bundleSlug: { featureId: feature.id, level, bundleSlug } },
  })
  if (!override) throw new Error(`No seeded BundlePriceOverride for (${featureSlug}, ${level}, ${bundleSlug}) — orphan Price with nowhere to land`)
  return override.id
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
        : entry.key.kind === 'override'
          ? await resolveOverrideId(entry.key.featureSlug, entry.key.level, entry.key.bundleSlug)
          : await resolveCreditPackId(entry.key.slug)
    resolved.push({ key: entry.key, id, stripePriceId: entry.stripePriceId })
  }

  const updated: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const { key, id, stripePriceId } of resolved) {
      if (key.kind === 'tier') {
        await tx.tier.update({ where: { id }, data: { stripePriceId } })
      } else if (key.kind === 'override') {
        await tx.bundlePriceOverride.update({ where: { id }, data: { stripePriceId } })
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
