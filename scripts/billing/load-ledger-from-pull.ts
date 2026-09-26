/**
 * Load pull #1 transactions into BillingLedgerEntry through ingestTransaction (the same path as the webhook).
 * Does not create GhlEvent rows.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/load-ledger-from-pull.ts <transactions.json>          # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/billing/load-ledger-from-pull.ts <transactions.json> --apply  # write
 *
 * Dry-run executes the real writes inside a transaction that is always rolled back (so the write path is
 * exercised, and a second pass proves idempotency), then verifies the table is unchanged.
 * Refuses the production host.
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ingestTransaction, type IngestResult } from "../../lib/billing/ingestTransaction";
import { normalizeTransaction } from "../../lib/billing/normalizeTransaction";

const PROD_HOST = "ep-restless-silence";
const apply = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) throw new Error("usage: load-ledger-from-pull.ts <transactions.json> [--apply]");

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL is not set.");
if (url.includes(PROD_HOST)) throw new Error("Refusing to run against the production host.");
console.log(`Host: ${new URL(url).host}`);
console.log(`Mode: ${apply ? "APPLY (writing)" : "dry-run (writes rolled back)"}\n`);

const prisma = new PrismaClient({ datasources: { db: { url } } });
class DryRunRollback extends Error {}
const last4 = (s: string) => `…${s.slice(-4)}`;

type Db = Parameters<typeof ingestTransaction>[1];

async function runAll(records: unknown[], db: Db) {
  const results: { rec: unknown; res: IngestResult }[] = [];
  for (const rec of records) results.push({ rec, res: await ingestTransaction(rec, db) });
  return results;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(file as string, "utf8"));
  const records: unknown[] = Array.isArray(raw) ? raw : raw.data;
  console.log(`Records in file: ${records.length}`);
  const before = await prisma.billingLedgerEntry.count();
  console.log(`BillingLedgerEntry rows before: ${before}\n`);

  let results: { rec: unknown; res: IngestResult }[] = [];
  let secondPassCount = -1;
  let rowsInTx = -1;

  if (apply) {
    results = await runAll(records, prisma);
  } else {
    try {
      await prisma.$transaction(
        async (tx) => {
          results = await runAll(records, tx);
          rowsInTx = await tx.billingLedgerEntry.count();
          await runAll(records, tx); // idempotency: same rows again
          secondPassCount = await tx.billingLedgerEntry.count();
          throw new DryRunRollback();
        },
        { timeout: 900_000, maxWait: 30_000 },
      );
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
  }

  const byClass: Record<string, { n: number; matched: number; unmatched: number }> = {};
  let ignored = 0;
  const ignoredReasons: Record<string, number> = {};
  const unclassified: string[] = [];
  for (const { rec, res } of results) {
    if (res.action === "ignored") {
      ignored++;
      ignoredReasons[res.reason] = (ignoredReasons[res.reason] ?? 0) + 1;
      continue;
    }
    const o = (byClass[res.classification] ??= { n: 0, matched: 0, unmatched: 0 });
    o.n++;
    res.matchedAccount ? o.matched++ : o.unmatched++;
    if (res.classification === "unclassified") {
      const n = normalizeTransaction(rec);
      unclassified.push(
        `${last4(n.id)} subType=${n.entitySourceSubType ?? "-"} entityType=${n.entityType ?? "-"} status=${n.status} amount=${n.amount} sub=${n.subscriptionId ? "y" : "n"} provider=${n.provider ?? "-"}`,
      );
    }
  }

  console.log(`Ignored: ${ignored}`, ignoredReasons);
  console.log("\nClassification | rows | matched to GhlAccount | unmatched");
  for (const [k, o] of Object.entries(byClass).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(22)} ${String(o.n).padStart(4)}  ${String(o.matched).padStart(4)}  ${String(o.unmatched).padStart(4)}`);
  const written = Object.values(byClass).reduce((a, o) => a + o.n, 0);
  console.log(`  ${"TOTAL written".padEnd(22)} ${String(written).padStart(4)}   (+${ignored} ignored = ${written + ignored})`);

  console.log(`\nUnclassified: ${unclassified.length}`);
  for (const u of unclassified) console.log(`  ${u}`);

  // Independent expectation check against pull #1 REPORT.md section 10.
  const norm = records.map((r) => normalizeTransaction(r));
  const expect = (label: string, expected: number, actual: number) =>
    console.log(`  ${actual === expected ? "OK  " : "DIFF"} ${label}: expected ${expected}, got ${actual}`);
  console.log("\nComparison with pull #1 REPORT.md §10:");
  expect("test-mode ignored (liveMode=false)", 42, ignored);
  expect("saas_one_time (auto + manual)", 457, (byClass.wallet_auto_recharge?.n ?? 0) + (byClass.wallet_manual_recharge?.n ?? 0));
  expect("  wallet_auto_recharge", 357, byClass.wallet_auto_recharge?.n ?? 0);
  expect("  wallet_manual_recharge", 100, byClass.wallet_manual_recharge?.n ?? 0);
  expect("$0 rows (all, per report)", 91, norm.filter((n) => n.amount === 0).length);
  console.log(`  INFO trial_auth written: ${byClass.trial_auth?.n ?? 0} (excludes $0 rows that are test-mode or saas_one_time)`);

  if (apply) {
    console.log(`\nBillingLedgerEntry rows after: ${await prisma.billingLedgerEntry.count()}`);
  } else {
    console.log(`\nDry-run transaction: ${rowsInTx} rows after pass 1, ${secondPassCount} after pass 2 (idempotent: ${rowsInTx === secondPassCount}).`);
    console.log(`Rolled back — rows now: ${await prisma.billingLedgerEntry.count()} (was ${before}).`);
  }
}

main().finally(() => prisma.$disconnect());
