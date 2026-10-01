/**
 * CLI for the "replay" job (same lib function the GHL-triggered route runs).
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-replay.ts           # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-replay.ts --apply   # write
 * No time budget, no self-continuation. Refuses the production host.
 */
import { runJob } from "../../lib/billing/jobs/runner";
import { connect } from "./_cli";

const { db, apply } = await connect();
runJob("replay", { db, apply, budgetMs: Infinity, selfContinue: false })
  .then((o) => console.log(JSON.stringify(o, null, 2)))
  .finally(() => db.$disconnect());
