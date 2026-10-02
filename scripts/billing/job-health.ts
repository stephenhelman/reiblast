/** Read-only job staleness report. PRISMA_TARGET=dev npx tsx scripts/billing/job-health.ts */
import { getJobHealth, STALE_AFTER_HOURS } from "../../lib/billing/jobHealth";
import { connect } from "./_cli";

const { db } = await connect();
getJobHealth(db)
  .then((rows) => {
    console.log(`Stale = no success in ${STALE_AFTER_HOURS}h\n`);
    for (const r of rows) {
      console.log(
        `${r.job.padEnd(13)} ${r.stale ? "STALE" : "ok   "}  lastOkAt=${r.lastOkAt?.toISOString() ?? "never"}  lastStartAt=${r.lastStartAt?.toISOString() ?? "never"}  lastError=${r.lastError ?? "-"}`,
      );
    }
  })
  .finally(() => db.$disconnect());
