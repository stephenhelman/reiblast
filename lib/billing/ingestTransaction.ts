import { Prisma, type PrismaClient } from "@prisma/client";
import { classify, CLASSIFIER_VERSION } from "./classify";
import { getBillingDb } from "./db";
import { normalizeTransaction, unwrapTransaction } from "./normalizeTransaction";

type Db = Pick<PrismaClient, "ghlAccount" | "billingLedgerEntry">;

export type IngestResult =
  | { action: "ignored"; reason: string }
  | { action: "written"; classification: string; matchedAccount: boolean; ghlTransactionId: string };

/**
 * The ONLY writer of BillingLedgerEntry. Shared by the webhook route and the historical load.
 * Accepts a transaction in either GHL shape. No GHL calls, no state changes, no tags, no stage moves.
 */
export async function ingestTransaction(txn: unknown, db?: Db): Promise<IngestResult> {
  const client: Db = db ?? (await getBillingDb());
  const t = normalizeTransaction(txn);
  const c = classify(t);
  if (c.classification === "ignore") return { action: "ignored", reason: c.reason };

  const account = t.contactId
    ? await client.ghlAccount.findUnique({ where: { contactId: t.contactId }, select: { id: true } })
    : null;

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
    update: { ...fields, ...(account ? { ghlAccountId: account.id } : {}) },
  });

  return { action: "written", classification: c.classification, matchedAccount: !!account, ghlTransactionId: t.id };
}
