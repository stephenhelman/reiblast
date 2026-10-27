/**
 * Backfill GhlAccount.setupFeeStatus: every member account with a null status becomes NOT_REQUIRED (existing members never owed an OP
 * setup fee). Optional --paid-contact <hqContactId> (repeatable, or --paid-contact=<id>) then sets those members to PAID. No GHL calls.
 * Dry-run by default; idempotent.
 *
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-setup-fee-status.ts --i-mean-production                       # dry-run
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-setup-fee-status.ts --i-mean-production --apply --paid-contact <id>
 */
import { connect } from "./_cli";
import { runSetupFeeBackfill } from "../../lib/billing/setupFeeBackfill";

const { db: prisma, apply } = await connect();

function paidContacts(argv: string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === "--paid-contact" && argv[i + 1]) out.push(argv[i + 1]);
    else if (a.startsWith("--paid-contact=")) out.push(a.slice("--paid-contact=".length));
  });
  return out;
}
const last4 = (s: string) => `…${s.slice(-4)}`;

async function main() {
  const r = await runSetupFeeBackfill(prisma, { apply, paidContactIds: paidContacts(process.argv) });
  console.log(`Member accounts with null setupFeeStatus: ${r.nullMembers}`);
  console.log(`  ${apply ? `Set NOT_REQUIRED: ${r.notRequiredSet}` : `Would set NOT_REQUIRED: ${r.nullMembers}`}`);
  console.log(`--paid-contact: requested ${r.paid.requested}, matched ${r.paid.matched}, already PAID ${r.paid.alreadyPaid}`);
  if (r.paid.missing.length) console.log(`  No member account for: ${r.paid.missing.map(last4).join(", ")} (nothing written for these)`);
  console.log(`  ${apply ? `Set PAID: ${r.paid.applied}` : `Would set PAID: ${r.paid.toSet}`}`);
  if (!apply) console.log("\nDry-run. Re-run with --apply.");
}

main().finally(() => prisma.$disconnect());
