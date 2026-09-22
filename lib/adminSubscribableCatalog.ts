// The catalog list the Phase 3.5 "+ Add subscription" picker needs: every
// Feature that actually has Tier rows (Pack has none — §5a, pay-go only,
// never a subscription target — so it's naturally excluded, not filtered by
// name). Read-only, admin-surface only.

import type { PrismaClient, TierLevel } from "@prisma/client";
import { deriveTierName } from "@/lib/catalogDerive";

export interface SubscribableTier {
  tierId: string;
  level: TierLevel;
  priceCents: number;
  displayName: string;
}

export interface SubscribableFeature {
  featureId: string;
  featureSlug: string;
  tiers: SubscribableTier[];
}

export async function getSubscribableCatalog(db: PrismaClient): Promise<SubscribableFeature[]> {
  const features = await db.feature.findMany({
    where: { tiers: { some: {} } },
    include: { tiers: { orderBy: { priceCents: "asc" } }, surfaces: true },
  });

  return features.map((f) => ({
    featureId: f.id,
    featureSlug: f.slug,
    tiers: f.tiers.map((t) => ({
      tierId: t.id,
      level: t.level,
      priceCents: t.priceCents,
      displayName: deriveTierName(f.unifiedName ?? f.surfaces[0]?.name ?? f.slug, t),
    })),
  }));
}
