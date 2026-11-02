/**
 * Set or clear a member's special-account EXEMPTION (GhlAccount.exemptUntil / exemptReason). While now < exemptUntil the dunning engine takes no
 * adverse automatic action for the account (no strikes, payment_failed, pause, churn or expired-sub move); decisions are still recorded with a
 * reason starting "exempt", payments still cure, and manual stage commands still apply. DB only — never writes to GHL.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/set-exemption.ts --location-id=<id> --until=2026-12-31 --reason="…"   # dry-run
 *   … --clear                       # remove the exemption
 *   … --apply                       # write (production also needs BILLING_DB_TARGET=prod + --i-mean-production + typed host, see _cli.ts)
 *
 * --until is a Denver calendar date and is EXCLUSIVE: exempt while now < 00:00 America/Denver on that date. Member accounts only.
 */
import { diffExemption, exemptionUpdate, parseExemptionOptions } from "../../lib/billing/exemption";
import { arg, connect } from "./_cli";

const { db, apply } = await connect();

async function main() {
  const parsed = parseExemptionOptions(arg, (n) => process.argv.includes(`--${n}`));
  if (!parsed.ok) throw new Error(parsed.error);
  const { plan, warnings } = parsed;

  const account = await db.ghlAccount.findFirst({
    where: { locationId: plan.locationId },
    select: { id: true, accountType: true, billingState: true, exemptUntil: true, exemptReason: true, user: { select: { businessName: true } } },
  });
  if (!account) throw new Error(`no GhlAccount with locationId …${plan.locationId.slice(-4)}`);
  if (account.accountType !== "member") throw new Error(`…${plan.locationId.slice(-4)} is an ${account.accountType} account; exemptions apply to member accounts only`);

  const before = { exemptUntil: account.exemptUntil, exemptReason: account.exemptReason };
  const after = exemptionUpdate(plan);
  console.log(`Account …${account.id.slice(-4)}  location …${plan.locationId.slice(-4)}  state ${account.billingState ?? "(unseeded)"}  (${account.user?.businessName ? "business name on file" : "no business name"})\n`);
  console.log("field          before                                   after");
  for (const d of diffExemption(before, after)) console.log(`${d.changed ? "*" : " "} ${d.field.padEnd(13)} ${d.before.padEnd(40)} ${d.after}`);
  for (const w of warnings) console.log(`\nWARNING: ${w}`);
  console.log("\nNote: DB only. This does not change the account's state, pause status or GHL stage.");

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply.");
    return;
  }
  const res = await db.ghlAccount.update({ where: { id: account.id }, data: after, select: { exemptUntil: true, exemptReason: true } });
  console.log("\nWritten. Now:", JSON.stringify({ exemptUntil: res.exemptUntil?.toISOString() ?? null, exemptReason: res.exemptReason }));
}

main().finally(() => db.$disconnect());
