import type { PrismaClient } from "@prisma/client";

export const JOB_NAMES = ["replay", "tx_sweep", "wallet_usage", "balances", "sub_sweep"] as const;
export type JobName = (typeof JOB_NAMES)[number];
export const isJobName = (v: unknown): v is JobName => typeof v === "string" && (JOB_NAMES as readonly string[]).includes(v);

export type JobCursor = Record<string, unknown>;

export type JobContext = {
  db: PrismaClient;
  /** false = dry-run: read and compute, write nothing. */
  apply: boolean;
  cursor: JobCursor | null;
  now: Date;
  /** True when the time budget is nearly spent and the job should persist its cursor and return { done: false }. */
  shouldYield(): boolean;
};

export type JobResult = { done: boolean; cursor?: JobCursor; summary: Record<string, unknown> };
export type JobFn = (ctx: JobContext) => Promise<JobResult>;
