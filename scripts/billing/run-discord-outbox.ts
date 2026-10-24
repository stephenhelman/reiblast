/**
 * CLI for the "discord_outbox" job (same lib function the GHL-triggered route runs).
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-discord-outbox.ts           # dry-run: writes NOTHING, reports what it would do
 *   PRISMA_TARGET=dev npx tsx scripts/billing/run-discord-outbox.ts --apply   # write (delivers due revokes to the bot — needs DISCORD_BOT_URL/DISCORD_BOT_OUTBOUND_SECRET)
 * No time budget, no self-continuation. Refuses the production host.
 */
import { runJob } from "../../lib/billing/jobs/runner";
import { connect } from "./_cli";

const { db, apply } = await connect();
runJob("discord_outbox", { db, apply, budgetMs: Infinity, selfContinue: false })
  .then((o) => console.log(JSON.stringify(o, null, 2)))
  .finally(() => db.$disconnect());
