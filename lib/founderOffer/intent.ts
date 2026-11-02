import { Prisma, type PrismaClient } from "@prisma/client";
import { FOUNDER_DEDUPE_PREFIX, sendIntent, type SendDeps } from "@/lib/billing/intents/send";
import { INLINE_SEND_TIMEOUT_MS } from "@/lib/billing/onboardingIntents";
import { FOUNDERS_PROMO } from "./discordEvents";
import { fetchHqContactIdentity, type HqContactIdentity } from "./hqContact";

export { FOUNDER_DEDUPE_PREFIX };
export const FOUNDER_FIRST_AMOUNT = "0";
export const FOUNDER_PAID_AMOUNT = "100";

/** FOUNDER_INTENTS=live sends; anything else (including unset) records skipped_shadow and never sends. Independent of DUNNING_MODE. */
export function founderIntentsMode(env: Record<string, string | undefined> = process.env): "live" | "shadow" {
  return env.FOUNDER_INTENTS === "live" ? "live" : "shadow";
}

export const founderDedupeKey = (claimId: string, attempt: number) => `${FOUNDER_DEDUPE_PREFIX}${claimId}:${attempt}`;

/** Which OP workflow branch this payload is for. Same values as the `intent` OP sends back on /api/webhooks/op/invoice. */
export type FounderIntentKind = "founders_offer" | "setup_fee";

/** What the OP workflow receives. All values are strings; hqContactId is the key it matches on, email is data only. */
export type FounderIntentPayload = {
  intent: FounderIntentKind;
  promo: string;
  claimToken: string;
  claimNumber: string;
  isFirst: "true" | "false";
  amount: "0" | "100";
  hqContactId: string;
  hqLocationId: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
};

export type FounderIntentSource = {
  claim: { id: string; token: string; claimNumber: number; isFirst: boolean; attempt: number };
  account: { id: string; contactId: string };
  /** What the DB holds; replaced by the HQ contact's values after commit when that fetch works. */
  user: { email: string; name: string | null; businessPhone: string | null };
};

export function splitName(name: string | null): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export function buildFounderPayload(src: FounderIntentSource, env: Record<string, string | undefined> = process.env): FounderIntentPayload {
  const { firstName, lastName } = splitName(src.user.name);
  return {
    intent: "founders_offer",
    promo: FOUNDERS_PROMO,
    claimToken: src.claim.token,
    claimNumber: String(src.claim.claimNumber),
    isFirst: src.claim.isFirst ? "true" : "false",
    amount: src.claim.isFirst ? FOUNDER_FIRST_AMOUNT : FOUNDER_PAID_AMOUNT,
    hqContactId: src.account.contactId,
    hqLocationId: env.GHL_HQ_LOCATION_ID ?? "",
    email: src.user.email,
    phone: src.user.businessPhone ?? "",
    firstName,
    lastName,
  };
}

/** HQ contact values win where present; anything the fetch lacks keeps the DB value. */
export function mergeHqIdentity(p: FounderIntentPayload, hq: HqContactIdentity | null): FounderIntentPayload {
  if (!hq) return p;
  return { ...p, firstName: hq.firstName ?? p.firstName, lastName: hq.lastName ?? p.lastName, email: hq.email ?? p.email, phone: hq.phone ?? p.phone };
}

type Db = Pick<PrismaClient, "ghlIntent">;

/** Sibling of enqueuePlacementIntent: same outbox, `founder` pipeline, `founder:<claimId>:<attempt>` key, own switch. Idempotent on the key. */
export async function enqueueFounderIntent(db: Db, src: FounderIntentSource, env: Record<string, string | undefined> = process.env): Promise<{ id: string; created: boolean }> {
  const dedupeKey = founderDedupeKey(src.claim.id, src.claim.attempt);
  try {
    const row = await db.ghlIntent.create({
      data: {
        ghlAccountId: src.account.id,
        kind: "founder",
        pipeline: "founder",
        payload: buildFounderPayload(src, env) as unknown as Prisma.InputJsonObject,
        dedupeKey,
        status: founderIntentsMode(env) === "live" ? "pending" : "skipped_shadow",
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const existing = await db.ghlIntent.findUnique({ where: { dedupeKey }, select: { id: true } });
    return { id: existing!.id, created: false };
  }
}

type SendDb = Pick<PrismaClient, "ghlIntent" | "founderClaim">;

/**
 * After the claim transaction commits: refresh the stored payload from the HQ contact (best effort), send inline (5s) when
 * FOUNDER_INTENTS=live, and stamp FounderClaim.intentSentAt on success. Never throws; a failure leaves the row pending/failed for
 * sendPendingIntents to retry with whatever payload is stored.
 */
export async function sendFounderIntentInline(
  db: SendDb,
  p: { intentId: string; claimId: string; contactId: string; env?: Record<string, string | undefined>; send?: SendDeps; fetchIdentity?: (contactId: string) => Promise<HqContactIdentity | null> },
): Promise<"sent" | "failed" | "skipped" | "off" | "error"> {
  try {
    if (founderIntentsMode(p.env) !== "live") return "off";
    const row = await db.ghlIntent.findUnique({ where: { id: p.intentId }, select: { payload: true } });
    const hq = await (p.fetchIdentity ?? ((c) => fetchHqContactIdentity(c, INLINE_SEND_TIMEOUT_MS)))(p.contactId);
    if (!hq) console.error("[founder-intent] HQ contact fetch failed; sending with DB values");
    else if (row) await db.ghlIntent.update({ where: { id: p.intentId }, data: { payload: mergeHqIdentity(row.payload as unknown as FounderIntentPayload, hq) as unknown as Prisma.InputJsonObject } });
    const out = await sendIntent(db, p.intentId, { timeoutMs: INLINE_SEND_TIMEOUT_MS, ...p.send, env: p.env ?? p.send?.env });
    if (out === "sent") await db.founderClaim.updateMany({ where: { id: p.claimId, intentSentAt: null }, data: { intentSentAt: new Date() } });
    return out;
  } catch (e) {
    console.error("[founder-intent] send failed:", e instanceof Error ? e.message : e);
    return "error";
  }
}
