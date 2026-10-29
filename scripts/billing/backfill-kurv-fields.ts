/**
 * Backfill BillingLedgerEntry's gateway/batch columns and re-run classifier v3, all from the stored raw (via
 * normalizeTransaction — the only raw reader). Prints a reconciliation of the Aug/Sep Kurv statements computed from the
 * values it WOULD write, before any write.
 *
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/backfill-kurv-fields.ts            # dry-run (default)
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/backfill-kurv-fields.ts --apply
 *
 * Writes only the new columns, classification and classifierVersion. ghlAccountId is never changed here; the number of
 * rows whose account link WOULD differ under the v3 match order (location first, contactId fallback) is reported.
 */
import { classify, CLASSIFIER_VERSION } from "../../lib/billing/classify";
import type { KurvTx } from "../../lib/billing/kurv/batch";
import { kurvFields } from "../../lib/billing/kurv/ledgerFields";
import { kurvRatesAsOf } from "../../lib/billing/kurv/rates";
import { reconcileMonth } from "../../lib/billing/kurv/reconcile";
import { STATEMENT_START } from "../../lib/billing/kurv/reference";
import { locationIdFromDescription } from "../../lib/billing/matchAccount";
import { normalizeTransaction } from "../../lib/billing/normalizeTransaction";
import { connect } from "./_cli";

const { db, apply } = await connect();
const usd = (c: number) => (c / 100).toFixed(2);

async function main() {
  const rows = await db.billingLedgerEntry.findMany({ select: { id: true, ghlTransactionId: true, classification: true, classifierVersion: true, ghlAccountId: true, occurredAt: true, raw: true } });
  const members = await db.ghlAccount.findMany({ where: { accountType: "member" }, select: { id: true, contactId: true, locationId: true } });
  const byLoc = new Map(members.filter((m) => m.locationId).map((m) => [m.locationId!, m.id]));
  const byContact = new Map(members.filter((m) => m.contactId).map((m) => [m.contactId!, m.id]));
  const first = rows.reduce((m, r) => (r.occurredAt < m ? r.occurredAt : m), rows[0]?.occurredAt ?? new Date());
  console.log(`Ledger rows: ${rows.length}   earliest occurredAt: ${first.toISOString().slice(0, 10)}   classifier v${CLASSIFIER_VERSION}\n`);

  const matrix = new Map<string, number>();
  const plan: { id: string; data: ReturnType<typeof kurvFields> & { classification: never; classifierVersion: number } }[] = [];
  const txs: KurvTx[] = [];
  let rematch = 0, errors = 0, batchRows = 0;

  for (const r of rows) {
    let t;
    try {
      t = normalizeTransaction(r.raw);
    } catch (e) {
      errors++;
      console.log(`  normalize error …${r.ghlTransactionId.slice(-4)}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const c = classify(t);
    const after = c.classification === "ignore" ? r.classification : c.classification;
    matrix.set(`${r.classification} → ${after}`, (matrix.get(`${r.classification} → ${after}`) ?? 0) + 1);
    const f = kurvFields(t);
    if (f.batchDate) batchRows++;
    plan.push({ id: r.id, data: { ...f, classification: after as never, classifierVersion: CLASSIFIER_VERSION } });
    txs.push({
      chargeId: t.chargeId ?? "0", status: t.status, transactionType: t.transactionType,
      submitTimeUtc: t.submitTimeUtc?.toISOString() ?? null, settleAmount: t.settleAmountCents === null ? null : t.settleAmountCents / 100, cardBrand: t.cardBrand,
    });
    const loc = locationIdFromDescription(t.description);
    const want = (loc && byLoc.get(loc)) || (t.contactId && byContact.get(t.contactId)) || null;
    if (want && want !== r.ghlAccountId) rematch++;
  }

  console.log("Classification before → after:");
  for (const [k, n] of [...matrix].sort()) console.log(`  ${k.split(" → ")[0] === k.split(" → ")[1] ? "  " : "* "}${k.padEnd(48)} ${String(n).padStart(5)}`);
  console.log(`\nRows with batch fields (settled sales): ${batchRows}   normalize errors: ${errors}`);
  console.log(`Rows whose account link would differ under v3 matching (NOT written here): ${rematch}`);

  console.log("\n=== Reconciliation vs Kurv statements (predicted from the values above) ===");
  const settings = await db.settingRate.findMany();
  if (!settings.length) console.log("SettingRate is empty — run seed-statement.ts first to see fee reconciliation.");
  else {
    const rates = kurvRatesAsOf(settings, STATEMENT_START);
    console.log(`(rates as of ${STATEMENT_START}; ledger starts ${first.toISOString().slice(0, 10)}, so Aug is partial)`);
    for (const month of ["2026-08", "2026-09"]) {
      const rec = reconcileMonth(txs, month, rates);
      console.log(`\n${month}  batches (windows): ${rec.batches}`);
      for (const x of rec.rows) {
        const fmt = (n: number) => (x.unit === "cents" ? "$" + usd(n) : String(n));
        const pct = x.actual ? ((x.predicted - x.actual) / x.actual) * 100 : 0;
        const ok = Math.abs(pct) <= x.tolerancePct + 1e-9 ? "ok" : "MISS";
        console.log(`  ${x.label.padEnd(28)} predicted ${fmt(x.predicted).padStart(10)}  actual ${fmt(x.actual).padStart(10)}  ${pct.toFixed(2).padStart(7)}%  (tol ${x.tolerancePct}%) ${ok}`);
      }
    }
  }

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply.");
    return;
  }
  let n = 0;
  for (const p of plan) {
    await db.billingLedgerEntry.update({ where: { id: p.id }, data: p.data });
    if (++n % 200 === 0) console.log(`  …${n}/${plan.length}`);
  }
  console.log(`\nUpdated ${n} rows.`);
}

main().finally(() => db.$disconnect());
