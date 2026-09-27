import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { getBillingDb } from "@/lib/billing/db";
import { claim, runJob, configuredBudgetMs, MAX_CONTINUATIONS } from "@/lib/billing/jobs/runner";
import { isJobName, type JobCursor, type JobName } from "@/lib/billing/jobs/types";
import { checkSecret, headerNames, bodyKeys, type Reason } from "@/lib/billing/reason";

// GHL scheduled workflow → nightly data jobs (docs/billing-jobs.md). No Vercel Cron.
// Responds 200 immediately and runs the job via waitUntil; a job that reaches its time budget stores a cursor in
// JobRun and POSTs to this route again to continue.
//
// PLAN ASSUMPTION: Vercel Hobby (no Fluid Compute) caps serverless functions at 60s, so maxDuration = 60 and the
// default working budget is 45s (JOBS_TIME_BUDGET_MS to override). On Pro, raise maxDuration (up to 300) and the budget.
export const maxDuration = 60;

const CONT_KEY = "_continuation";

/** Records the trigger attempt (GhlEvent, source "job_trigger") before replying — every attempt, accepted or not. Never
 *  logs header/body values, only header names and body key names (contract: no secrets in logs or the response). */
async function record(
  db: Awaited<ReturnType<typeof getBillingDb>> | null,
  req: NextRequest,
  reason: Reason,
  job: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<NextResponse> {
  const payload = { reason, headersPresent: headerNames(req), contentType: req.headers.get("content-type"), bodyKeys: extra.bodyKeys ?? [], ...(extra.jobRunId ? { jobRunId: extra.jobRunId } : {}) };
  if (db) {
    try {
      await db.ghlEvent.create({ data: { source: "job_trigger", externalId: job ?? null, payload: payload as Prisma.InputJsonObject } });
    } catch (err) {
      console.error("[jobs] failed to record trigger attempt:", err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ accepted: reason === "accepted", ...(job ? { job } : {}), reason });
}

export async function POST(req: NextRequest) {
  let db: Awaited<ReturnType<typeof getBillingDb>> | null = null;
  try {
    const auth = checkSecret(req.headers.get("x-reiblast-jobs-secret"), "GHL_JOBS_SECRET");
    if (auth === "misconfigured") {
      console.error("[jobs] GHL_JOBS_SECRET is not set — refusing all triggers");
      return record(null, req, "server_misconfigured", undefined);
    }
    if (auth === "missing") {
      console.warn("[jobs] auth missing — ignoring");
      db = await getBillingDb();
      return record(db, req, "auth_missing", undefined);
    }
    if (auth === "failed") {
      console.warn("[jobs] auth failed — ignoring");
      db = await getBillingDb();
      return record(db, req, "auth_failed", undefined);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn("[jobs] invalid JSON body — ignoring");
      db = await getBillingDb();
      return record(db, req, "bad_json", undefined);
    }
    const keys = bodyKeys(body);
    db = await getBillingDb();

    if (!isJobName(body.job)) {
      console.warn("[jobs] unknown job — ignoring");
      return record(db, req, "unknown_job", undefined, { bodyKeys: keys });
    }
    const job: JobName = body.job;

    const cursor = body.cursor && typeof body.cursor === "object" && !Array.isArray(body.cursor) ? (body.cursor as JobCursor) : null;
    const continuation = Number(cursor?.[CONT_KEY] ?? 0);
    if (continuation > MAX_CONTINUATIONS) {
      console.warn(`[jobs] ${job}: incoming cursor already past the continuation cap — ignoring`);
      return record(db, req, "continuation_cap", job, { bodyKeys: keys });
    }

    let preClaimed = false;
    if (!cursor) {
      if (!(await claim(db, job))) {
        console.warn(`[jobs] ${job}: trigger ignored — a run started within the guard window is still in flight`);
        return record(db, req, "in_flight", job, { bodyKeys: keys });
      }
      preClaimed = true;
    }

    const jobRun = await db.jobRun.upsert({ where: { job }, create: { job }, update: {} });

    waitUntil(
      runJob(job, { db: db!, apply: true, cursor, budgetMs: configuredBudgetMs(), selfContinue: true, preClaimed })
        .then((o) => console.log(`[jobs] ${job}:`, o.status))
        .catch((e) => console.error(`[jobs] ${job} crashed:`, e instanceof Error ? e.message : e)),
    );
    return record(db, req, "accepted", job, { bodyKeys: keys, jobRunId: jobRun.id });
  } catch (err) {
    console.error("[jobs] unexpected error:", err instanceof Error ? err.message : err);
    return record(db, req, "server_misconfigured", undefined);
  }
}
