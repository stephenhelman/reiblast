import { Prisma, type PrismaClient } from "@prisma/client";
import { classify, CLASSIFIER_VERSION } from "./classify";
import { getBillingDb } from "./db";
import { locationIdFromDescription, shouldStampRefundDetected, type MatchMethod } from "./matchAccount";
import { normalizeTransaction, unwrapTransaction } from "./normalizeTransaction";

type Db = Pick<PrismaClient, "ghlAccount" | "billingLedgerEntry">;

export type IngestResult =
  | { action: "ignored"; reason: string }
  | { action: "written"; classification: string; matchedAccount: boolean; matchMethod: MatchMethod | null; ghlTransactionId: string; refundDetected: boolean };

/**
 * The ONLY writer of BillingLedgerEntry. Shared by the webhook route and the historical load.
 * Accepts a transaction in either GHL shape. No GHL calls, no state changes, no tags, no stage moves.
 */
export async function ingestTransaction(txn: unknown, db?: Db, opts: { now?: Date } = {}): Promise<IngestResult> {
  const client: Db = db ?? (await getBillingDb());
  const t = normalizeTransaction(txn);
  const c = classify(t);
  if (c.classification === "ignore") return { action: "ignored", reason: c.reason };

  // Only MEMBER accounts match: internal accounts (owner/HQ) are never a member's payer.
  let account = t.contactId
    ? await client.ghlAccount.findFirst({ where: { contactId: t.contactId, accountType: "member" }, select: { id: true } })
    : null;
  let matchMethod: MatchMethod | null = account ? "contactId" : null;

  // Fallback for auto-recharges whose payer contact isn't a known member: the description embeds the member's location URL.
  if (!account && c.classification === "wallet_auto_recharge") {
    const locationId = locationIdFromDescription(t.description);
    if (locationId) {
      account = await client.ghlAccount.findFirst({ where: { locationId, accountType: "member" }, select: { id: true } });
      if (account) matchMethod = "descriptionLocation";
    }
  }

  const existing = await client.billingLedgerEntry.findUnique({
    where: { ghlTransactionId: t.id },
    select: { amountRefunded: true, refundDetectedAt: true },
  });
  const stampRefund = !!existing && shouldStampRefundDetected(Number(existing.amountRefunded), t.amountRefunded, existing.refundDetectedAt);

  const raw = unwrapTransaction(txn) as Prisma.InputJsonObject; // exactly as received (array unwrapped)
  const fields = {
    classification: c.classification,
    classifierVersion: CLASSIFIER_VERSION,
    status: t.status,
    amount: new Prisma.Decimal(String(t.amount)),
    amountRefunded: new Prisma.Decimal(String(t.amountRefunded)),
    raw,
  };

  await client.billingLedgerEntry.upsert({
    where: { ghlTransactionId: t.id },
    create: {
      ghlTransactionId: t.id,
      ghlAccountId: account?.id ?? null,
      contactId: t.contactId,
      provider: t.provider ?? "unknown",
      subscriptionId: t.subscriptionId,
      occurredAt: t.occurredAt,
      ...fields,
    },
    // Refresh only what can change after the fact; a later-created account may link an earlier unmatched row.
    update: { ...fields, ...(account ? { ghlAccountId: account.id } : {}), ...(stampRefund ? { refundDetectedAt: opts.now ?? new Date() } : {}) },
  });

  return { action: "written", classification: c.classification, matchedAccount: !!account, matchMethod, ghlTransactionId: t.id, refundDetected: stampRefund };
}
