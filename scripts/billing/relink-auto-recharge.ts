/**
 * One-off, idempotent: link existing wallet_auto_recharge ledger rows that have no GhlAccount to the member whose
 * locationId appears in the description URL (the same fallback ingestTransaction now applies). Only fills
 * ghlAccountId where it is null; never changes any other column.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/relink-auto-recharge.ts          # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/billing/relink-auto-recharge.ts --apply  # write
 * Refuses the production host.
 */
import { locationIdFromDescription } from "../../lib/billing/matchAccount";
import { normalizeTransaction } from "../../lib/billing/normalizeTransaction";
import { connect } from "./_cli";

const { db, apply } = await connect();

async function main() {
  const rows = await db.billingLedgerEntry.findMany({ where: { classification: "wallet_auto_recharge", ghlAccountId: null }, select: { id: true, ghlTransactionId: true, raw: true, amount: true, status: true, occurredAt: true } });
  console.log(`Unmatched wallet_auto_recharge rows: ${rows.length}`);
  let matched = 0;
  for (const r of rows) {
    const locationId = locationIdFromDescription(normalizeTransaction(r.raw).description);
    const account = locationId ? await db.ghlAccount.findFirst({ where: { locationId, accountType: "member" }, select: { id: true } }) : null;
    console.log(`  …${r.ghlTransactionId.slice(-4)} ${r.occurredAt.toISOString().slice(0, 10)} ${r.status} ${r.amount} url-location=${locationId ? `…${locationId.slice(-4)}` : "none"} → ${account ? "MATCH" : "no GhlAccount"}`);
    if (!account) continue;
    matched++;
    if (apply) await db.billingLedgerEntry.updateMany({ where: { id: r.id, ghlAccountId: null }, data: { ghlAccountId: account.id } });
  }
  console.log(`\nMatched by descriptionLocation: ${matched} of ${rows.length}${apply ? " (written)" : " (dry-run, nothing written)"}`);
}

main().finally(() => db.$disconnect());
