import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { apiStats } from "../ghlWallet";
import { JOBS } from "./index";
import type { JobContext, JobCursor, JobName } from "./types";

// Hobby plan: serverless functions are capped at 60s (route maxDuration = 60), so the default working budget is 45s,
// leaving ~15s for cursor persistence and the continuation POST. Override with JOBS_TIME_BUDGET_MS.
export const DEFAULT_BUDGET_MS = 45_000;
export const YIELD_MARGIN_MS = 6_000; // start handing off this long before the budget ends
export const MAX_CONTINUATIONS = 10;
export const GUARD_MINUTES = 10;

export function configuredBudgetMs(): number {
  const n = Number(process.env.JOBS_TIME_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_MS;
}

export type RunOptions = {
  db: PrismaClient;
  /** false = dry-run: no JobRun bookkeeping, jobs write nothing. */
  apply: boolean;
  cursor?: JobCursor | null;
  /** Use Infinity for CLI runs (no time budget, no continuation). */
  budgetMs?: number;
  /** POST to our own route when the budget runs out (route runs only). */
  selfContinue?: boolean;
  /** The caller already ran `claim()` (or this is a continuation) and confirmed it succeeded — skip claiming again. */
  preClaimed?: boolean;
};

export type RunOutcome =
  | { status: "ignored_in_flight" }
  | { status: "done"; summary: Record<string, unknown> }
  | { status: "continued"; summary: Record<string, unknown>; continuation: number }
  | { status: "cap_hit"; summary: Record<string, unknown> }
  | { status: "error"; error: string };

const CONT_KEY = "_continuation";

/** Atomic claim: succeeds only if no run started in the last GUARD_MINUTES without finishing (success or error). Exported so
 *  the jobs route can claim synchronously, before responding, and report "in_flight" when it can't. */
export async function claim(db: PrismaClient, job: JobName): Promise<boolean> {
  // Bootstrap: the UPDATE below matches nothing on a table with no row for this job, which would read as "in flight"
  // forever. "id" has no DB default (Prisma generates cuids client-side), so supply one.
  await db.$executeRaw`INSERT INTO "JobRun" ("id", "job") VALUES (${randomUUID()}, ${job}) ON CONFLICT ("job") DO NOTHING`;
  const n = await db.$executeRaw`
    UPDATE "JobRun" SET "lastStartAt" = NOW(), "lastError" = NULL
    WHERE "job" = ${job}
      AND ("lastStartAt" IS NULL
        OR "lastStartAt" < NOW() - (${GUARD_MINUTES} * INTERVAL '1 minute')
        OR ("lastOkAt" IS NOT NULL AND "lastOkAt" >= "lastStartAt")
        OR "lastError" IS NOT NULL)`;
  return n === 1;
}

const heartbeat = (db: PrismaClient, job: JobName) =>
  db.$executeRaw`UPDATE "JobRun" SET "lastStartAt" = NOW(), "lastError" = NULL WHERE "job" = ${job}`;

function continuationBase(): string | null {
  if (process.env.JOBS_BASE_URL) return process.env.JOBS_BASE_URL.replace(/\/$/, "");
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
}

async function postContinuation(job: JobName, cursor: JobCursor): Promise<void> {
  const base = continuationBase();
  const secret = process.env.GHL_JOBS_SECRET;
  if (!base || !secret) throw new Error("cannot continue: JOBS_BASE_URL/VERCEL_URL or GHL_JOBS_SECRET not set");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const res = await fetch(`${base}/api/webhooks/ghl/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-reiblast-jobs-secret": secret, ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) },
    body: JSON.stringify({ job, cursor }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`continuation POST failed: HTTP ${res.status}`);
}

export async function runJob(job: JobName, opts: RunOptions): Promise<RunOutcome> {
  const { db, apply } = opts;
  const budget = opts.budgetMs ?? configuredBudgetMs();
  const started = Date.now();
  const incoming = opts.cursor ?? null;
  const continuation = Number(incoming?.[CONT_KEY] ?? 0);
  const jobCursor: JobCursor | null = incoming ? Object.fromEntries(Object.entries(incoming).filter(([k]) => k !== CONT_KEY)) : null;

  if (apply) {
    await db.jobRun.upsert({ where: { job }, create: { job }, update: {} });
    if (!incoming && !opts.preClaimed) {
      if (!(await claim(db, job))) {
        console.warn(`[jobs] ${job}: trigger ignored — a run started within ${GUARD_MINUTES} minutes is still in flight`);
        const prev = await db.jobRun.findUnique({ where: { job }, select: { lastSummary: true } });
        const base = (prev?.lastSummary && typeof prev.lastSummary === "object" ? prev.lastSummary : {}) as Record<string, unknown>;
        await db.jobRun.update({
          where: { job },
          data: { lastSummary: { ...base, ignoredTriggers: Number(base.ignoredTriggers ?? 0) + 1, lastIgnoredAt: new Date().toISOString() } as Prisma.InputJsonObject },
        });
        return { status: "ignored_in_flight" };
      }
    } else {
      await heartbeat(db, job);
    }
  }

  const callsAtStart = apiStats.calls;
  const ctx: JobContext = {
    db,
    apply,
    cursor: jobCursor,
    now: new Date(),
    shouldYield: () => Date.now() - started >= budget - YIELD_MARGIN_MS,
  };
  const stats = () => ({ runMs: Date.now() - started, ghlApiCalls: apiStats.calls - callsAtStart, continuation });

  try {
    const result = await JOBS[job](ctx);
    const summary = { ...result.summary, ...stats() };

    if (result.done) {
      if (apply) {
        await db.$executeRaw`UPDATE "JobRun" SET "lastOkAt" = NOW() WHERE "job" = ${job}`;
        await db.jobRun.update({ where: { job }, data: { cursor: Prisma.DbNull, lastError: null, lastSummary: summary as Prisma.InputJsonObject } });
      }
      return { status: "done", summary };
    }

    const next = continuation + 1;
    const nextCursor = { ...(result.cursor ?? {}), [CONT_KEY]: next } as JobCursor;
    if (next > MAX_CONTINUATIONS) {
      const capped = { ...summary, capHit: true, maxContinuations: MAX_CONTINUATIONS };
      if (apply) await db.jobRun.update({ where: { job }, data: { cursor: nextCursor as Prisma.InputJsonObject, lastError: `continuation cap (${MAX_CONTINUATIONS}) reached`, lastSummary: capped as Prisma.InputJsonObject } });
      return { status: "cap_hit", summary: capped };
    }
    if (apply) await db.jobRun.update({ where: { job }, data: { cursor: nextCursor as Prisma.InputJsonObject, lastSummary: summary as Prisma.InputJsonObject } });
    if (opts.selfContinue) await postContinuation(job, nextCursor);
    return { status: "continued", summary, continuation: next };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${job} failed:`, error);
    if (apply) await db.jobRun.update({ where: { job }, data: { lastError: error.slice(0, 500), lastSummary: { error, ...stats() } as Prisma.InputJsonObject } });
    return { status: "error", error };
  }
}
