/**
 * Seed the partner-statement reference data: Kurv rates + fixed costs (effective 2026-10-01), the Aug/Sep reference
 * KurvStatements, and the opening reserve balance. Idempotent (upserts by natural key); never overwrites a row that exists.
 *
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/seed-statement.ts            # dry-run
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/seed-statement.ts --apply
 */
import { KURV_REFERENCE_STATEMENTS, OPENING_RESERVE, SEED_FIXED_COSTS, SEED_RATES, STATEMENT_START } from "../../lib/billing/kurv/reference";
import { connect } from "./_cli";

const { db, apply } = await connect();
const d = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function main() {
  let created = 0, existed = 0;
  const note = (what: string, isNew: boolean) => {
    console.log(`  ${isNew ? "+" : "="} ${what}`);
    isNew ? created++ : existed++;
  };

  console.log("SettingRate");
  for (const r of SEED_RATES) {
    const key = { key_effectiveFrom: { key: r.key, effectiveFrom: d(STATEMENT_START) } };
    const isNew = !(await db.settingRate.findUnique({ where: key }));
    note(`${r.key} = ${r.value} @ ${STATEMENT_START}`, isNew);
    if (apply && isNew) await db.settingRate.create({ data: { key: r.key, value: r.value, effectiveFrom: d(STATEMENT_START), note: r.note } });
  }
  console.log("FixedCost");
  for (const c of SEED_FIXED_COSTS) {
    const isNew = !(await db.fixedCost.findUnique({ where: { name_effectiveFrom: { name: c.name, effectiveFrom: d(STATEMENT_START) } } }));
    note(`${c.name} $${(c.monthlyAmountCents / 100).toFixed(2)}/mo @ ${STATEMENT_START}`, isNew);
    if (apply && isNew) await db.fixedCost.create({ data: { name: c.name, monthlyAmountCents: c.monthlyAmountCents, effectiveFrom: d(STATEMENT_START) } });
  }
  console.log("KurvStatement (reference)");
  for (const s of KURV_REFERENCE_STATEMENTS) {
    const isNew = !(await db.kurvStatement.findUnique({ where: { month: s.month } }));
    note(`${s.month}: ${s.salesCount} sales / $${(s.salesAmountCents / 100).toFixed(2)}, daily $${(s.dailyFeesPaidCents / 100).toFixed(2)}, reserve +$${(s.reserveFundedCents / 100).toFixed(2)}, debit $${(s.monthlyDebitCents / 100).toFixed(2)}`, isNew);
    if (apply && isNew) await db.kurvStatement.create({ data: { ...s } });
  }
  console.log("ReserveMovement (opening balance)");
  const opening = await db.reserveMovement.findFirst({ where: { date: d(OPENING_RESERVE.date), kind: "adjustment", note: OPENING_RESERVE.note } });
  note(`adjustment +$${(OPENING_RESERVE.amountCents / 100).toFixed(2)} @ ${OPENING_RESERVE.date}`, !opening);
  if (apply && !opening) await db.reserveMovement.create({ data: { date: d(OPENING_RESERVE.date), kind: "adjustment", amountCents: OPENING_RESERVE.amountCents, note: OPENING_RESERVE.note } });

  console.log(`\n${apply ? "Wrote" : "Would write"} ${created} rows; ${existed} already present.${apply ? "" : " Dry-run: re-run with --apply."}`);
}

main().finally(() => db.$disconnect());
