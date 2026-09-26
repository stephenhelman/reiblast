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
