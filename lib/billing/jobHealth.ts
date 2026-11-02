import type { PrismaClient } from "@prisma/client";
import { JOB_NAMES, type JobName } from "./jobs/types";

export const STALE_AFTER_HOURS = 26;
/** Jobs that run far more often than nightly go stale sooner: discord_outbox runs every 15 minutes, so 1 hour = four missed runs. */
export const STALE_AFTER_HOURS_BY_JOB: Partial<Record<JobName, number>> = { discord_outbox: 1 };

export type JobHealth = {
  job: JobName;
  lastOkAt: Date | null;
  lastStartAt: Date | null;
  lastError: string | null;
  /** No successful run within the job's window — 26 hours, or STALE_AFTER_HOURS_BY_JOB (a job that has never succeeded is stale). */
  stale: boolean;
  hoursSinceOk: number | null;
};

/** Read-only. One entry per job, including jobs that have never run. */
export async function getJobHealth(db: PrismaClient, now = new Date(), env: Record<string, string | undefined> = process.env): Promise<JobHealth[]> {
  // wallet_retention ships disabled: until WALLET_RETENTION_ENABLED=true it is neither scheduled nor expected, so it isn't "stale".
  const names = JOB_NAMES.filter((j) => j !== "wallet_retention" || env.WALLET_RETENTION_ENABLED === "true");
  const rows = await db.jobRun.findMany({ where: { job: { in: [...names] } } });
  const byJob = new Map(rows.map((r) => [r.job, r]));
  return names.map((job) => {
    const r = byJob.get(job);
    const lastOkAt = r?.lastOkAt ?? null;
    const hoursSinceOk = lastOkAt ? (now.getTime() - lastOkAt.getTime()) / 36e5 : null;
    return { job, lastOkAt, lastStartAt: r?.lastStartAt ?? null, lastError: r?.lastError ?? null, stale: hoursSinceOk === null || hoursSinceOk > (STALE_AFTER_HOURS_BY_JOB[job] ?? STALE_AFTER_HOURS), hoursSinceOk };
  });
}
