import { randomBytes } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { checkEligibility, loadEligibilityInput, type IneligibleReason } from "./eligibility";
import { enqueueFounderIntent, sendFounderIntentInline } from "./intent";
import { countSlotsTaken, dbNow } from "./slots";
import { claimWindow, type ClaimWindow } from "./window";

export const CLAIM_TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

/** What the page shows for a claim. */
export type ClaimView = { token: string; status: "FREE_WINNER" | "PENDING_PAYMENT" | "PAID" | "RELEASED"; isFirst: boolean; claimNumber: number; attempt: number };

export type ClaimOutcome =
  | { result: "claimed"; claim: ClaimView; intentId: string; contactId: string; claimId: string }
  | { result: "existing"; claim: ClaimView }
  | { result: "sold_out" }
  | { result: "not_open"; window: Exclude<ClaimWindow, "open"> }
  | { result: "ineligible"; reason: IneligibleReason };

export type ClaimDb = Pick<PrismaClient, "$transaction">;

const newToken = () => randomBytes(24).toString("base64url");
const view = (c: { token: string; status: ClaimView["status"]; isFirst: boolean; claimNumber: number; attempt: number }): ClaimView => ({
  token: c.token, status: c.status, isFirst: c.isFirst, claimNumber: c.claimNumber, attempt: c.attempt,
});

/**
 * The claim transaction. One interactive $transaction, serialized by a global advisory lock so two claimants can never both take the
 * last slot or the same claimNumber. No network calls inside; the intent is only RECORDED here and sent after commit.
 */
export async function claimFounderSlotTx(db: ClaimDb, ghlAccountId: string, env: Record<string, string | undefined> = process.env): Promise<ClaimOutcome> {
  return db.$transaction(async (t) => {
    const tx = t as unknown as Prisma.TransactionClient;
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext('founder_claim'))) AS t`;
    const now = await dbNow(tx);

    const window = claimWindow(now, env);
    if (window !== "open") return { result: "not_open", window };

    const elig = checkEligibility(await loadEligibilityInput(tx, ghlAccountId));
    if (!elig.eligible) return { result: "ineligible", reason: elig.reason };

    const existing = await tx.founderClaim.findUnique({ where: { ghlAccountId } });
    if (existing && existing.status !== "RELEASED") return { result: "existing", claim: view(existing) };

    if ((await countSlotsTaken(tx, now)) >= 10) return { result: "sold_out" };

    const isFirst = !(await tx.founderClaim.findFirst({ where: { status: "FREE_WINNER" }, select: { id: true } }));
    const claimNumber = ((await tx.founderClaim.aggregate({ _max: { claimNumber: true } }))._max.claimNumber ?? 0) + 1;
    const status = isFirst ? "FREE_WINNER" : "PENDING_PAYMENT";
    const token = newToken();

    const claim = existing
      ? await tx.founderClaim.update({
          where: { id: existing.id },
          data: { attempt: existing.attempt + 1, token, claimNumber, status, isFirst, invoiceId: null, invoiceUrl: null, intentSentAt: null, releasedAt: null, claimedAt: now },
        })
      : await tx.founderClaim.create({ data: { token, ghlAccountId, claimNumber, status, isFirst, claimedAt: now } });

    const account = await tx.ghlAccount.findUniqueOrThrow({ where: { id: ghlAccountId }, select: { id: true, contactId: true, user: { select: { email: true, name: true, businessPhone: true } } } });
    const { id: intentId } = await enqueueFounderIntent(tx, { claim, account: { id: account.id, contactId: account.contactId }, user: account.user }, env);
    return { result: "claimed", claim: view(claim), intentId, contactId: account.contactId, claimId: claim.id };
  }, CLAIM_TX_OPTIONS);
}

/** Claim, then (after commit) send the intent inline. The send never throws and never changes the outcome the page sees. */
export async function claimFounderSlot(
  db: ClaimDb & Pick<PrismaClient, "ghlIntent" | "founderClaim">,
  ghlAccountId: string,
  env: Record<string, string | undefined> = process.env,
  deps: Pick<Parameters<typeof sendFounderIntentInline>[1], "send" | "fetchIdentity"> = {},
): Promise<ClaimOutcome> {
  const out = await claimFounderSlotTx(db, ghlAccountId, env);
  if (out.result === "claimed") await sendFounderIntentInline(db, { intentId: out.intentId, claimId: out.claimId, contactId: out.contactId, env, ...deps });
  return out;
}

/** The member's own claim for the page (no window or eligibility check: a revisit shows current status). */
export async function getClaimView(db: Pick<PrismaClient, "founderClaim">, ghlAccountId: string): Promise<ClaimView | null> {
  const c = await db.founderClaim.findUnique({ where: { ghlAccountId } });
  return c && c.status !== "RELEASED" ? view(c) : null;
}
