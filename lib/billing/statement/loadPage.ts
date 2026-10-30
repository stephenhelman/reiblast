import { Prisma } from "@prisma/client";
import type { Freshness } from "./freshness";
import type { StatementDb } from "./compute";

/** One round of cheap aggregates feeding the "data through" stamps. */
export async function loadFreshness(db: StatementDb, month: string): Promise<Freshness> {
  const [ledger] = await db.$queryRaw<{ t: Date | null }[]>(Prisma.sql`SELECT MAX("updatedAt") AS "t" FROM "BillingLedgerEntry"`);
  const [wallet] = await db.$queryRaw<{ s: Date | null; c: Date | null }[]>(Prisma.sql`SELECT MAX("settlementTime") AS "s", MAX("createdAt") AS "c" FROM "WalletTransaction"`);
  const kurv = await db.kurvStatement.findUnique({ where: { month }, select: { enteredAt: true } });
  return { ledgerAt: ledger?.t ?? null, walletLastRowAt: wallet?.s ?? null, walletIngestedAt: wallet?.c ?? null, kurvEnteredAt: kurv?.enteredAt ?? null };
}
