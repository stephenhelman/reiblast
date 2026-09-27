import type { PrismaClient } from "@prisma/client";

export type WalletLocation = { locationId: string; ghlAccountId: string | null };

/**
 * Every MEMBER GhlAccount.locationId plus the HQ location (GHL_HQ_LOCATION_ID), sorted for stable cursor indexes.
 * Internal accounts (e.g. the owner account whose locationId IS the HQ location) are excluded, so HQ appears exactly
 * once — from the env var, with ghlAccountId null — and is never queried twice.
 */
export async function listWalletLocations(db: PrismaClient): Promise<WalletLocation[]> {
  const accounts = await db.ghlAccount.findMany({ where: { locationId: { not: null }, accountType: "member" }, select: { id: true, locationId: true } });
  const byLoc = new Map<string, string | null>();
  for (const a of accounts) if (a.locationId) byLoc.set(a.locationId, a.id);
  const hq = process.env.GHL_HQ_LOCATION_ID;
  if (hq && !byLoc.has(hq)) byLoc.set(hq, null);
  return [...byLoc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([locationId, ghlAccountId]) => ({ locationId, ghlAccountId }));
}
