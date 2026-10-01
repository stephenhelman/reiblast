/**
 * CLI for the "sub_sweep" job (same lib function the GHL-triggered route runs).
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-sub-sweep.ts           # dry-run: writes NOTHING, reports what it would emit
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-sub-sweep.ts --apply   # write (the first run only seeds GhlSubscriptionState, emitting no events)
 * No time budget, no self-continuation. Refuses the production host.
 */
import { runJob } from "../../lib/billing/jobs/runner";
import { connect } from "./_cli";

const { db, apply } = await connect();
runJob("sub_sweep", { db, apply, budgetMs: Infinity, selfContinue: false })
  .then((o) => console.log(JSON.stringify(o, null, 2)))
  .finally(() => db.$disconnect());
