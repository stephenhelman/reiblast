import { prisma } from "@/lib/prisma";
import { countSlotsTaken, slotsLeftFrom } from "./slots";

/** Length of the free trial in Founder's Offer copy. Deliberately not lib/pricing.ts TRIAL_LENGTH_DAYS (7, the standard trial). */
export const FOUNDER_TRIAL_DAYS = 14;

/**
 * Gate for the /founders page. Open only when FOUNDER_OFFER_ENABLED === "true" AND FOUNDER_OFFER_ENDS_AT parses to a
 * valid date AND now is before it. Missing or invalid values fail closed. Server-side only, read at request time, so the
 * page turns off at the deadline (or when the flag is flipped) without a redeploy.
 */
export function isFounderOfferOpen(now: Date = new Date()): boolean {
  if (process.env.FOUNDER_OFFER_ENABLED !== "true") return false;
  const raw = process.env.FOUNDER_OFFER_ENDS_AT;
  if (!raw) return false;
  const endsAt = new Date(raw);
  if (Number.isNaN(endsAt.getTime())) return false;
  return now.getTime() < endsAt.getTime();
}

/** GHL form URL for the Founder's Offer checkout, or null when unset (a null link also means the offer is closed). */
export function getFounderCheckoutLink(): string | null {
  return process.env.FOUNDER_CHECKOUT_LINK?.trim() || null;
}

export { FOUNDER_SLOTS_TOTAL } from "./slots";

/** Founder slots still open, from the live FounderClaim table (see slots.ts for the 25-hour hold rule). */
export async function getFounderSlotsLeft(): Promise<number> {
  return slotsLeftFrom(await countSlotsTaken(prisma));
}
