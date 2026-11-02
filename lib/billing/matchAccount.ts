/** Pure. Auto-recharge descriptions embed the member's sub-account URL (…/location/<locationId>/…). */
export function locationIdFromDescription(description: string | null | undefined): string | null {
  const m = /\/location\/([A-Za-z0-9]+)/.exec(description ?? "");
  return m ? m[1] : null;
}

/** True when an update raises amountRefunded and no refund had been detected before. Never resets an existing timestamp. */
export function shouldStampRefundDetected(prevRefunded: number, nextRefunded: number, prevDetectedAt: Date | null): boolean {
  return prevDetectedAt === null && nextRefunded > prevRefunded;
}

export type MatchMethod = "contactId" | "descriptionLocation";

type AccountFinder = { ghlAccount: { findFirst: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string } | null> } };

/**
 * Member account for a payment. The location id parsed from the description URL wins (it names the sub-account the money
 * was for); contactId is the fallback. Internal accounts never match.
 */
export async function matchMemberAccount(
  db: AccountFinder,
  description: string | null,
  contactId: string | null,
): Promise<{ account: { id: string } | null; matchMethod: MatchMethod | null }> {
  const locationId = locationIdFromDescription(description);
  if (locationId) {
    const account = await db.ghlAccount.findFirst({ where: { locationId, accountType: "member" }, select: { id: true } });
    if (account) return { account, matchMethod: "descriptionLocation" };
  }
  if (contactId) {
    const account = await db.ghlAccount.findFirst({ where: { contactId, accountType: "member" }, select: { id: true } });
    if (account) return { account, matchMethod: "contactId" };
  }
  return { account: null, matchMethod: null };
}
