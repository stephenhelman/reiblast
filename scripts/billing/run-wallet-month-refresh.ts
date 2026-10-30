/**
 * CLI for the "wallet_month_refresh" job (same lib function the GHL-triggered route runs).
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/run-wallet-month-refresh.ts           # dry-run
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/run-wallet-month-refresh.ts --apply   # write
 * No time budget, no self-continuation. Refuses the production host unless the full production confirmation is given (see _cli.ts).
 */
import { runJob } from "../../lib/billing/jobs/runner";
import { connect } from "./_cli";

const { db, apply } = await connect();
runJob("wallet_month_refresh", { db, apply, budgetMs: Infinity, selfContinue: false })
  .then((o) => console.log(JSON.stringify(o, null, 2)))
  .finally(() => db.$disconnect());
