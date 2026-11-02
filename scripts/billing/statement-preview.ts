/**
 * Prints the live partner statement for a month, every line with its source and estimate/actual flag. Read-only.
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/statement-preview.ts --month=2026-10
 */
import { computeMonthStatement, outstandingBalance, reserveBalance } from "../../lib/billing/statement/compute";
import { arg, connect } from "./_cli";

const { db } = await connect();
const usd = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const month = arg("month") ?? "2026-10";
  const s = await computeMonthStatement(db, month);
  console.log(`=== Partner statement ${s.month}  ${s.closed ? "(CLOSED)" : "(open)"}${s.partial ? "  PARTIAL: month not over, figures are to-date" : ""} ===\n`);
  for (const l of s.lines) console.log(`${l.key === "deposits" ? "  " : "− "}${l.label.padEnd(28)} ${usd(l.amountCents).padStart(12)}  [${l.basis}]  ${l.source}`);
  console.log(`${"".padEnd(30, "-")}\n  ${"Net".padEnd(28)} ${usd(s.netCents).padStart(12)}\n  ${("Owed to Stephen (" + s.splitPct * 100 + "%)").padEnd(28)} ${usd(s.owedCents).padStart(12)}\n`);
  const d = s.deposits;
  console.log(`Deposits: ${d.batches} batches, ${d.items} sales, gross ${usd(d.grossCents)}, daily fees ${usd(d.dailyFeesCents)}${d.discountCents === null ? "" : ` (discount ${usd(d.discountCents)} + other ${usd(d.otherFeesCents!)})`}, reserve ${usd(d.reserveCents)}`);
  const e = s.monthlyDebit.estimate;
  if (e) console.log(`Monthly debit estimate: ${e.authorizations} auths ${usd(e.authFeesCents)} + AVS(est) ${usd(e.avsFeesCents)} + brand ${usd(e.brandFeesCents)} + fixed ${usd(e.fixedCents)}${s.monthlyDebit.toDateOnly ? "  (to-date activity)" : ""}`);
  console.log(`\nWallet debits (${s.wallet.debitCount} rows), by category:`);
  const byCat = new Map<string, number>();
  for (const r of s.wallet.breakdown) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.cents);
  for (const [c, v] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(26)} ${usd(v).padStart(12)}`);
  const byScope = new Map<string, number>();
  for (const r of s.wallet.breakdown) byScope.set(r.scope, (byScope.get(r.scope) ?? 0) + r.cents);
  console.log(`  by scope: ${[...byScope].map(([k, v]) => `${k} ${usd(v)}`).join(" | ")}`);
  console.log(`  agency recharge credits (not a cost): ${usd(s.wallet.rechargeCreditsCents)}   plan-like rows excluded: ${s.wallet.planRowsExcluded.count} (${usd(s.wallet.planRowsExcluded.cents)})`);
  console.log(`\nReserve (company money, never split): funded ${usd(s.reserve.fundedCents)}, releases ${usd(s.reserve.releasesCents)}, withdrawals ${usd(s.reserve.withdrawalsCents)}; closing balance ${usd(s.reserve.closingBalanceCents)} (live ${usd(await reserveBalance(db))})`);
  const o = await outstandingBalance(db);
  console.log(`Outstanding: closed owed ${usd(o.owedClosedCents)} − paid ${usd(o.paidCents)} = ${usd(o.outstandingCents)}`);
}
main().finally(() => db.$disconnect());
