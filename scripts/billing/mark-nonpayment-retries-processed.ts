/**
 * One-off cleanup for the replay bug: review records (stage_change_unmapped, client_handoff_review) and any other non-payment GhlEvent that the
 * replay job wrongly retried as a payment ("GHL transaction fetch failed: HTTP 422") carry attempts > 0 and/or a lastError and a null processedAt.
 * This marks exactly those rows processed (processedAt = now). NOTHING ELSE changes: attempts, lastError, payload and every other column stay as
 * they are, and rows that were never retried (attempts 0, no lastError) are left alone.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/mark-nonpayment-retries-processed.ts            # dry-run (default): counts + sample ids
 *   … --apply                                                                                # write (production: see _cli.ts guard)
 *
 * Scope: source NOT in the replay whitelist (payment, stage_change, invoice, op_invoice) and NOT job_trigger (already processed at insert).
 */
import { REPLAYABLE_SOURCES } from "../../lib/billing/processPaymentEvent";
import { connect } from "./_cli";

const { db, apply } = await connect();

async function main() {
  const where = {
    processedAt: null,
    source: { notIn: [...REPLAYABLE_SOURCES, "job_trigger"] },
    OR: [{ attempts: { gt: 0 } }, { lastError: { not: null } }],
  };
  const rows = await db.ghlEvent.findMany({ where, select: { id: true, source: true, attempts: true, lastError: true }, orderBy: { receivedAt: "asc" } });
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log(`Wrongly-retried non-payment rows (processedAt null, attempts > 0 or lastError set): ${rows.length}`);
  for (const [s, n] of bySource) console.log(`  ${s}: ${n}`);
  const errs = new Map<string, number>();
  for (const r of rows) errs.set((r.lastError ?? "(none)").slice(0, 60), (errs.get((r.lastError ?? "(none)").slice(0, 60)) ?? 0) + 1);
  for (const [e, n] of errs) console.log(`  lastError "${e}": ${n}`);
  console.log(`  sample ids: ${rows.slice(0, 5).map((r) => r.id).join(", ") || "—"}`);

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply to set processedAt on these rows (no other column is touched).");
    return;
  }
  const res = await db.ghlEvent.updateMany({ where: { id: { in: rows.map((r) => r.id) }, processedAt: null }, data: { processedAt: new Date() } });
  console.log(`\nMarked processed: ${res.count}`);
}

main().finally(() => db.$disconnect());
