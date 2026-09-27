/**
 * Re-run the classifier over every BillingLedgerEntry (from the stored raw, via normalizeTransaction). `classification` is
 * updated only where it changes; `classifierVersion` is stamped with the CURRENT version on EVERY row it evaluates, so after
 * a run the whole ledger carries one version.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/reclassify-ledger.ts            # dry-run: prints the before→after matrix
 *   PRISMA_TARGET=dev npx tsx scripts/billing/reclassify-ledger.ts --apply    # write the changes
 * A row the classifier would now "ignore" (test mode) is reported but never changed. Refuses the production host.
 */
import { classify, CLASSIFIER_VERSION } from "../../lib/billing/classify";
import { normalizeTransaction } from "../../lib/billing/normalizeTransaction";
import { connect } from "./_cli";

const { db, apply } = connect();

async function main() {
  const rows = await db.billingLedgerEntry.findMany({ select: { id: true, ghlTransactionId: true, classification: true, classifierVersion: true, status: true, amount: true, provider: true, occurredAt: true, raw: true } });
  console.log(`Ledger rows: ${rows.length}   classifier version: ${CLASSIFIER_VERSION}\n`);

  const matrix = new Map<string, number>(); // "before → after"
  const versions = new Map<number, number>();
  const changes: { id: string; from: string; to: string; row: (typeof rows)[number] }[] = [];
  const wouldIgnore: string[] = [];
  const restamp: string[] = []; // evaluated rows whose stored classifierVersion differs from the current one (ids)
  const errors: string[] = [];

  for (const r of rows) {
    versions.set(r.classifierVersion, (versions.get(r.classifierVersion) ?? 0) + 1);
    let after: string;
    let errored = false;
    try {
      const c = classify(normalizeTransaction(r.raw));
      if (c.classification === "ignore") {
        wouldIgnore.push(r.ghlTransactionId);
        after = r.classification; // never change on ignore
      } else after = c.classification;
    } catch (err) {
      errored = true;
      errors.push(`…${r.ghlTransactionId.slice(-4)}: ${err instanceof Error ? err.message : err}`);
      after = r.classification;
    }
    if (!errored && r.classifierVersion !== CLASSIFIER_VERSION) restamp.push(r.id);
    const key = `${r.classification} → ${after}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
    if (after !== r.classification) changes.push({ id: r.id, from: r.classification, to: after, row: r });
  }

  console.log("Stored classifierVersion counts:", Object.fromEntries(versions));
  console.log("\nBefore → after (count):");
  for (const [k, n] of [...matrix].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [from, to] = k.split(" → ");
    console.log(`  ${from === to ? "  " : "* "}${k.padEnd(52)} ${String(n).padStart(4)}`);
  }
  console.log(`\nReclassified rows: ${changes.length}${changes.length ? "" : " (none)"}`);
  for (const c of changes) console.log(`  …${c.row.ghlTransactionId.slice(-4)} ${c.from} → ${c.to}  status=${c.row.status} $${c.row.amount} ${c.row.provider} ${c.row.occurredAt.toISOString().slice(0, 10)}`);
  console.log(`\nRows whose stored classifierVersion will be stamped ${CLASSIFIER_VERSION}: ${restamp.length}`);
  if (wouldIgnore.length) console.log(`\nWould now be ignored (test-mode; NOT changed): ${wouldIgnore.length}`);
  if (errors.length) console.log(`\nNormalize errors (rows left as-is): ${errors.length}\n  ${errors.join("\n  ")}`);

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply.");
    return;
  }
  let written = 0;
  for (const c of changes) {
    const res = await db.billingLedgerEntry.updateMany({ where: { id: c.id, classification: c.from as never }, data: { classification: c.to as never, classifierVersion: CLASSIFIER_VERSION } });
    written += res.count;
  }
  console.log(`\nReclassified ${written} rows (classification + classifierVersion=${CLASSIFIER_VERSION}).`);
  let stamped = 0;
  for (let i = 0; i < restamp.length; i += 500) {
    const res = await db.billingLedgerEntry.updateMany({ where: { id: { in: restamp.slice(i, i + 500) }, classifierVersion: { not: CLASSIFIER_VERSION } }, data: { classifierVersion: CLASSIFIER_VERSION } });
    stamped += res.count;
  }
  console.log(`Stamped classifierVersion=${CLASSIFIER_VERSION} on ${stamped} further rows.`);
}

main().finally(() => db.$disconnect());
