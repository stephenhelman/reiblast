import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getBillingDb } from "@/lib/billing/db";
import { runJob, configuredBudgetMs } from "@/lib/billing/jobs/runner";
import { isJobName, type JobCursor } from "@/lib/billing/jobs/types";
import { secretMatches } from "@/lib/billing/secret";

// GHL scheduled workflow → nightly data jobs (docs/billing-jobs.md). No Vercel Cron.
// Responds 200 immediately and runs the job via waitUntil; a job that reaches its time budget stores a cursor in
// JobRun and POSTs to this route again to continue.
//
// PLAN ASSUMPTION: Vercel Hobby (no Fluid Compute) caps serverless functions at 60s, so maxDuration = 60 and the
// default working budget is 45s (JOBS_TIME_BUDGET_MS to override). On Pro, raise maxDuration (up to 300) and the budget.
export const maxDuration = 60;

const reply = (accepted: boolean, job?: string) => NextResponse.json({ accepted, ...(job ? { job } : {}) });

export async function POST(req: NextRequest) {
  try {
    if (!secretMatches(req.headers.get("x-reiblast-jobs-secret"), "GHL_JOBS_SECRET")) {
      console.warn("[jobs] auth failed — ignoring");
      return reply(false);
    }
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn("[jobs] invalid JSON body — ignoring");
      return reply(false);
    }
    if (!isJobName(body.job)) {
      console.warn("[jobs] unknown job — ignoring");
      return reply(false);
    }
    const cursor = body.cursor && typeof body.cursor === "object" && !Array.isArray(body.cursor) ? (body.cursor as JobCursor) : null;
    const job = body.job;
    const db = await getBillingDb();

    waitUntil(
      runJob(job, { db, apply: true, cursor, budgetMs: configuredBudgetMs(), selfContinue: true })
        .then((o) => console.log(`[jobs] ${job}:`, o.status))
        .catch((e) => console.error(`[jobs] ${job} crashed:`, e instanceof Error ? e.message : e)),
    );
    return reply(true, job);
  } catch (err) {
    console.error("[jobs] unexpected error:", err instanceof Error ? err.message : err);
    return reply(false);
  }
}
