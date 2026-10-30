/**
 * CLI for the "wallet_retention" job (same lib function the GHL-triggered route runs).
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/run-wallet-retention.ts           # dry-run
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/run-wallet-retention.ts --apply   # write
 * No time budget, no self-continuation. Refuses the production host unless the full production confirmation is given (see _cli.ts).
 */
import { runJob } from "../../lib/billing/jobs/runner";
import { connect } from "./_cli";

const { db, apply } = await connect();
runJob("wallet_retention", { db, apply, budgetMs: Infinity, selfContinue: false })
  .then((o) => console.log(JSON.stringify(o, null, 2)))
  .finally(() => db.$disconnect());
