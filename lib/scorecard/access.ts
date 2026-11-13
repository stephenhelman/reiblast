import type { PrismaClient } from "@prisma/client";

/**
 * THE rule for "this location may see / be sent a scorecard": the member's User is active and owns the location (User.ghlLocationId).
 * Used by the signed-link view page (one location) and the scorecard_weekly job (a batch) — keep the rule here only.
 */
export async function activeMemberLocationIds(db: Pick<PrismaClient, "user">, locationIds: string[]): Promise<Set<string>> {
  if (locationIds.length === 0) return new Set();
  const rows = await db.user.findMany({ where: { ghlLocationId: { in: locationIds }, status: "active" }, select: { ghlLocationId: true } });
  return new Set(rows.map((r) => r.ghlLocationId).filter((l): l is string => !!l));
}

export async function isActiveMemberLocation(db: Pick<PrismaClient, "user">, locationId: string): Promise<boolean> {
  return (await activeMemberLocationIds(db, [locationId])).has(locationId);
}
