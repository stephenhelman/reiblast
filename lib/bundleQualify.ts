import { TierLevel } from '@prisma/client'

// The shared bundle-qualification contract: Pass 2 (checkout/webhook) and
// Pass 3 (surfaces) both import this. Bundle membership is DERIVED from a
// member's active tool_subs — there is no stored bundle-type row. Keyed by
// feature slug (bots = the REIclose surface pair, acq + dispo).
export type QualifyingTiers = Partial<Record<'score' | 'ask' | 'bots', TierLevel>>

export type BundleSlug = 'bundle-plus' | 'bundle-pro'

const LEVEL_RANK: Record<TierLevel, number> = { base: 0, plus: 1, pro: 2 }

function atLeast(level: TierLevel | undefined, floor: TierLevel): boolean {
  if (!level) return false
  return LEVEL_RANK[level] >= LEVEL_RANK[floor]
}

// Tier-floored: higher tiers still qualify (e.g. score/pro still meets
// Plus's score>=plus). Pro takes precedence when both qualify. Pack never
// affects qualification — it isn't a key in QualifyingTiers.
export function qualifyBundle(tiers: QualifyingTiers): BundleSlug | null {
  const qualifiesPro = atLeast(tiers.score, 'pro') && atLeast(tiers.ask, 'plus') && atLeast(tiers.bots, 'base')
  if (qualifiesPro) return 'bundle-pro'

  const qualifiesPlus = atLeast(tiers.score, 'plus') && atLeast(tiers.ask, 'base')
  if (qualifiesPlus) return 'bundle-plus'

  return null
}
