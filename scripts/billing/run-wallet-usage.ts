/**
 * CLI for the "wallet_usage" job (same lib function the GHL-triggered route runs).
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-wallet-usage.ts           # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-wallet-usage.ts --apply   # write
 * No time budget, no self-continuation. Refuses the production host.
 */
import { runJob } from "../../lib/billing/jobs/runner";
import { connect } from "./_cli";

const { db, apply } = await connect();
runJob("wallet_usage", { db, apply, budgetMs: Infinity, selfContinue: false })
  .then((o) => console.log(JSON.stringify(o, null, 2)))
  .finally(() => db.$disconnect());
