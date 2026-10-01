/**
 * Set a member's manual core-subscription coverage override (and, optionally, correct their billing fields). DB only —
 * this never writes to GHL, so it does NOT move the account's GHL pipeline stage; keep the stage consistent by hand.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/set-coverage.ts --location-id=<id> --until=2026-11-21 --note="…" \
 *       [--state=active] [--pause-reason=none|non_payment|expired_invoice|voluntary|manual_killswitch] [--legacy-unreconciled=true|false]   # dry-run
 *   … --apply    # write
 *
 * --until is a Denver calendar date and is EXCLUSIVE: covered while now < 00:00 America/Denver on that date.
 * Member accounts only. Refuses the production host.
 */
import { applyPlan, coverageUpdate, diffSnapshots, parseCoverageOptions, type CoverageSnapshot } from "../../lib/billing/coverage";
import { arg, connect } from "./_cli";

const { db, apply } = await connect();

async function main() {
  const parsed = parseCoverageOptions(arg);
  if (!parsed.ok) throw new Error(parsed.error);
  const { plan, warnings } = parsed;

  const account = await db.ghlAccount.findFirst({
    where: { locationId: plan.locationId },
    select: { id: true, accountType: true, billingState: true, pauseReason: true, legacyUnreconciled: true, coreCoveredUntil: true, coreCoverageNote: true, user: { select: { businessName: true } } },
  });
  if (!account) throw new Error(`no GhlAccount with locationId …${plan.locationId.slice(-4)}`);
  if (account.accountType !== "member") throw new Error(`…${plan.locationId.slice(-4)} is an ${account.accountType} account; coverage applies to member accounts only`);

  const before: CoverageSnapshot = { billingState: account.billingState, pauseReason: account.pauseReason, legacyUnreconciled: account.legacyUnreconciled, coreCoveredUntil: account.coreCoveredUntil, coreCoverageNote: account.coreCoverageNote };
  const after = applyPlan(before, plan);
  console.log(`Account …${account.id.slice(-4)}  location …${plan.locationId.slice(-4)}  (${account.user?.businessName ? "business name on file" : "no business name"})\n`);
  console.log("field                 before                                   after");
  for (const d of diffSnapshots(before, after)) console.log(`${d.changed ? "*" : " "} ${d.field.padEnd(20)} ${d.before.padEnd(40)} ${d.after}`);
  for (const w of warnings) console.log(`\nWARNING: ${w}`);
  console.log("\nNote: DB only. The GHL pipeline stage is not changed by this script.");

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply.");
    return;
  }
  const res = await db.ghlAccount.update({ where: { id: account.id }, data: coverageUpdate(plan), select: { billingState: true, pauseReason: true, legacyUnreconciled: true, coreCoveredUntil: true, coreCoverageNote: true } });
  console.log("\nWritten. Now:", JSON.stringify({ ...res, coreCoveredUntil: res.coreCoveredUntil?.toISOString() ?? null }));
}

main().finally(() => db.$disconnect());
