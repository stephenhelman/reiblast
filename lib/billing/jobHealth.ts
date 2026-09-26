import type { PrismaClient } from "@prisma/client";
import { JOB_NAMES, type JobName } from "./jobs/types";

export const STALE_AFTER_HOURS = 26;

export type JobHealth = {
  job: JobName;
  lastOkAt: Date | null;
  lastStartAt: Date | null;
  lastError: string | null;
  /** No successful run in the last 26 hours (a job that has never succeeded is stale). */
  stale: boolean;
  hoursSinceOk: number | null;
};

/** Read-only. One entry per job, including jobs that have never run. */
export async function getJobHealth(db: PrismaClient, now = new Date()): Promise<JobHealth[]> {
  const rows = await db.jobRun.findMany({ where: { job: { in: [...JOB_NAMES] } } });
  const byJob = new Map(rows.map((r) => [r.job, r]));
  return JOB_NAMES.map((job) => {
    const r = byJob.get(job);
    const lastOkAt = r?.lastOkAt ?? null;
    const hoursSinceOk = lastOkAt ? (now.getTime() - lastOkAt.getTime()) / 36e5 : null;
    return { job, lastOkAt, lastStartAt: r?.lastStartAt ?? null, lastError: r?.lastError ?? null, stale: hoursSinceOk === null || hoursSinceOk > STALE_AFTER_HOURS, hoursSinceOk };
  });
}
