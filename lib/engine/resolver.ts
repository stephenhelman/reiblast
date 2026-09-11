import { PrismaClient, TierLevel } from '@prisma/client'

const LEVEL_ORDER: TierLevel[] = ['base', 'plus', 'pro']

export type ResolvedFeature = {
  level: TierLevel
  allowance: number | null
  used: number
  remaining: number | null // null = unlimited
  balance: number
  periodStart: Date
  periodEnd: Date
}

function calendarMonthWindow(now: Date): { periodStart: Date; periodEnd: Date } {
  // No member timezone column exists on User yet — base tier resolves in UTC only.
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { periodStart, periodEnd }
}

function maxLevel(levels: TierLevel[]): TierLevel {
  let best: TierLevel = 'base'
  for (const level of levels) {
    if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(best)) best = level
  }
  return best
}

export async function resolveFeature(
  prisma: PrismaClient,
  userId: string,
  featureSlug: string,
): Promise<ResolvedFeature> {
  const feature = await prisma.feature.findUniqueOrThrow({ where: { slug: featureSlug } })

  const activeSubs = await prisma.subscription.findMany({
    where: { userId, status: 'active' },
    include: {
      tier: true,
      bundle: { include: { tiers: { include: { tier: true } } } },
    },
  })

  // Gather every tier row (across solo tool_subs and expanded bundle tiers) that
  // covers this feature; extra/duplicate active subs are harmless — max(level)
  // neutralizes them (the resolver tolerates the unconstrained sub table).
  const coveringTiers: { level: TierLevel; sub: (typeof activeSubs)[number] }[] = []
  for (const sub of activeSubs) {
    if (sub.type === 'tool_sub' && sub.tier && sub.tier.featureId === feature.id) {
      coveringTiers.push({ level: sub.tier.level, sub })
    } else if (sub.type === 'bundle' && sub.bundle) {
      for (const bt of sub.bundle.tiers) {
        if (bt.tier.featureId === feature.id) coveringTiers.push({ level: bt.tier.level, sub })
      }
    }
  }

  let winningTier: { level: TierLevel; allowance: number | null } | null = null
  let periodStart: Date
  let periodEnd: Date

  if (coveringTiers.length > 0) {
    const level = maxLevel(coveringTiers.map((c) => c.level))
    const winner = coveringTiers.find((c) => c.level === level)!
    const tierRow = await prisma.tier.findUniqueOrThrow({
      where: { featureId_level: { featureId: feature.id, level } },
    })
    winningTier = { level: tierRow.level, allowance: tierRow.allowance }
    periodStart = winner.sub.periodStart
    periodEnd = winner.sub.periodEnd
  } else {
    const baseTier = await prisma.tier.findUniqueOrThrow({
      where: { featureId_level: { featureId: feature.id, level: 'base' } },
    })
    winningTier = { level: baseTier.level, allowance: baseTier.allowance }
    const window = calendarMonthWindow(new Date())
    periodStart = window.periodStart
    periodEnd = window.periodEnd
  }

  const used = await prisma.ledgerEntry.count({
    where: {
      userId,
      featureId: feature.id,
      allowanceCovered: true,
      outcome: 'success',
      createdAt: { gte: periodStart, lt: periodEnd },
    },
  })

  const wallet = await prisma.wallet.findUnique({ where: { userId } })
  const balance = wallet?.balance ?? 0

  const remaining =
    winningTier.allowance === null ? null : Math.max(0, winningTier.allowance - used)

  return {
    level: winningTier.level,
    allowance: winningTier.allowance,
    used,
    remaining,
    balance,
    periodStart,
    periodEnd,
  }
}
