import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getBillingDb } from "../db";
import { checkSecret, logInternalError, missingEnvVars, type Reason } from "../reason";
import type { ProcessResult } from "./stageChanged";

/**
 * Shared skeleton of the GHL → server event routes (contract rules 3, 5, 6): authenticate (timing-safe, header
 * x-reiblast-events-secret), parse, RECORD the event first, then process. ALWAYS returns 200; failures live in
 * GhlEvent.lastError / attempts and are retried by the replay job. The `reason` field uses the same vocabulary as
 * the jobs route (lib/billing/reason.ts); only the subset that applies here is ever returned.
 */
const reply = (reason: Reason) => NextResponse.json({ received: reason === "accepted", reason });

export async function handleEventRoute(req: NextRequest, cfg: { label: string; source: string; externalId: (body: Record<string, unknown>) => string | null; process: (eventId: string, db: Awaited<ReturnType<typeof getBillingDb>>) => Promise<ProcessResult> }): Promise<NextResponse> {
  try {
    const auth = checkSecret(req.headers.get("x-reiblast-events-secret"), "GHL_EVENTS_SECRET");
    if (auth === "misconfigured") {
      console.error(`[${cfg.label}] missing required env var(s):`, missingEnvVars(["GHL_EVENTS_SECRET"]).join(", "));
      return reply("server_misconfigured");
    }
    if (auth === "missing") {
      console.warn(`[${cfg.label}] auth missing — ignoring`);
      return reply("auth_missing");
    }
    if (auth === "failed") {
      console.warn(`[${cfg.label}] auth failed — ignoring`);
      return reply("auth_failed");
    }
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn(`[${cfg.label}] invalid JSON body — ignoring`);
      return reply("bad_json");
    }
    const db = await getBillingDb();
    let event: { id: string };
    try {
      event = await db.ghlEvent.create({ data: { source: cfg.source, externalId: cfg.externalId(body), payload: body as Prisma.InputJsonObject } });
    } catch (err) {
      // The insert itself failed (rule 5 broken) — still answer with a reason, never let this fall through unlogged.
      logInternalError(cfg.label, err);
      return reply("internal_error");
    }
    await cfg.process(event.id, db);
    return reply("accepted");
  } catch (err) {
    logInternalError(cfg.label, err);
    return reply("internal_error");
  }
}
