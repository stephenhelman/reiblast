import type { PrismaClient, SetupFeeStatus } from "@prisma/client";
import { customDataStringField } from "./events/payloadFields";

/**
 * OP Web Studio setup-fee status on GhlAccount (the only OP fact HQ holds). null reads as UNKNOWN everywhere.
 * The signup webhook sets it ONCE from customData (applySignupFee), the OP payment receiver later sets PAID (markSetupFeePaid).
 */
export const KNOWN_SIGNUP_OFFERS = ["standard-7", "founder-14", "ari-14", "ari-30"] as const;
const OFFER_MAX_LEN = 64;

export type ParsedSignupFee = {
  /** PENDING / NOT_REQUIRED when customData.setupFeeRequired was a clean "true"/"false"; otherwise null (stays UNKNOWN). */
  setupFeeStatus: "PENDING" | "NOT_REQUIRED" | null;
  /** A known offer, or an unrecognized-but-sane raw value (stored as sent); null when absent or unusable. */
  signupOffer: string | null;
};

/** Unrendered GHL merge tag, e.g. "{{custom_values.x}}" — never a real value. */
const isUnrendered = (v: string): boolean => v.includes("{{");

/**
 * Pure. Reads customData.setupFeeRequired ("true"/"false" after trim + lowercase) and customData.offer. Logs fixed markers only —
 * never the setupFeeRequired value, never contact data.
 */
export function parseSignupFee(body: Record<string, unknown>, log: (msg: string) => void = console.warn): ParsedSignupFee {
  let setupFeeStatus: ParsedSignupFee["setupFeeStatus"] = null;
  const rawFee = customDataStringField(body, "setupFeeRequired");
  if (rawFee !== undefined) {
    const v = rawFee.toLowerCase();
    if (isUnrendered(rawFee)) log("[setup-fee] setupFeeRequired unrendered_merge_tag");
    else if (v === "true") setupFeeStatus = "PENDING";
    else if (v === "false") setupFeeStatus = "NOT_REQUIRED";
    else log("[setup-fee] setupFeeRequired invalid_value");
  }

  let signupOffer: string | null = null;
  const rawOffer = customDataStringField(body, "offer");
  if (rawOffer !== undefined) {
    if (isUnrendered(rawOffer)) log("[setup-fee] offer unrendered_merge_tag");
    else if (rawOffer.length > OFFER_MAX_LEN) log("[setup-fee] offer too_long");
    else {
      signupOffer = rawOffer;
      if (!(KNOWN_SIGNUP_OFFERS as readonly string[]).includes(rawOffer)) log(`[setup-fee] offer unrecognized value=${JSON.stringify(rawOffer)}`);
    }
  }
  return { setupFeeStatus, signupOffer };
}

/** True only for NOT_REQUIRED or PAID. PENDING, UNKNOWN and null (= UNKNOWN) are not cleared. */
export function isSetupFeeCleared(status: SetupFeeStatus | null | undefined): boolean {
  return status === "NOT_REQUIRED" || status === "PAID";
}

type Db = Pick<PrismaClient, "ghlAccount">;

/**
 * Signup webhook step (runs AFTER ensureGhlAccount, in the caller's own try/catch). The "set once, never overwrite" rule is enforced
 * in the database — each field is a conditional updateMany — because the webhook also fires on renewals:
 *  - setupFeeStatus is written only where it is null or UNKNOWN, so PENDING/NOT_REQUIRED are never changed and PAID is never downgraded;
 *  - signupOffer is written only where it is null.
 * Only plain member accounts are touched. Returns how many rows each write changed.
 */
export async function applySignupFee(db: Db, userId: string, parsed: ParsedSignupFee): Promise<{ status: number; offer: number }> {
  const out = { status: 0, offer: 0 };
  if (parsed.setupFeeStatus) {
    out.status = (
      await db.ghlAccount.updateMany({
        where: { userId, accountType: "member", OR: [{ setupFeeStatus: null }, { setupFeeStatus: "UNKNOWN" }] },
        data: { setupFeeStatus: parsed.setupFeeStatus },
      })
    ).count;
  }
  if (parsed.signupOffer) {
    out.offer = (await db.ghlAccount.updateMany({ where: { userId, accountType: "member", signupOffer: null }, data: { signupOffer: parsed.signupOffer } })).count;
  }
  return out;
}

/** Sets PAID from any state (the OP setup-fee payment receiver will call this; no route yet). Idempotent. False when no such account. */
export async function markSetupFeePaid(db: Db, ghlAccountId: string): Promise<boolean> {
  return (await db.ghlAccount.updateMany({ where: { id: ghlAccountId }, data: { setupFeeStatus: "PAID" } })).count > 0;
}
