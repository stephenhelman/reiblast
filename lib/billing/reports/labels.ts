import type { PrismaClient } from "@prisma/client";
import { accountLabel, formatAccountLabel } from "@/lib/admin/accountLabel";

export type AcctInfo = { locationId: string | null; locationName: string | null; businessName: string | null };

/** Member accounts by id (one small query) — the source for every label in the money views. */
export async function accountInfo(db: PrismaClient): Promise<Map<string, AcctInfo>> {
  const a = await db.ghlAccount.findMany({ where: { accountType: "member" }, select: { id: true, locationId: true, locationName: true, user: { select: { businessName: true } } } });
  return new Map(a.map((x) => [x.id, { locationId: x.locationId, locationName: x.locationName, businessName: x.user?.businessName ?? null }]));
}

export const accountLabelOf = (info: Map<string, AcctInfo>, id: string | null, hq: string | null): { name: string; suffix: string | null } => {
  if (!id) return { name: "Unmatched (no account)", suffix: null };
  const i = info.get(id);
  return accountLabel({ locationId: i?.locationId ?? null, locationName: i?.locationName, businessName: i?.businessName }, hq);
};
export const accountLabelText = (info: Map<string, AcctInfo>, id: string | null, hq: string | null): string => formatAccountLabel(accountLabelOf(info, id, hq));

/** scopeKey → label (member locations, HQ, _agency, _unattributed). */
export function scopeLabelOf(info: Map<string, AcctInfo>, hq: string | null) {
  const byLoc = new Map([...info.values()].filter((i) => i.locationId).map((i) => [i.locationId as string, i]));
  return (scopeKey: string) => accountLabel({ scopeKey, locationName: byLoc.get(scopeKey)?.locationName, businessName: byLoc.get(scopeKey)?.businessName }, hq);
}
