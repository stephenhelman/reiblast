import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getBillingDb } from "../db";
import { secretMatches } from "../secret";
import { logInternalError, missingEnvVars, type Reason } from "../reason";
import { customDataStringField, redactCustomDataSecret } from "./payloadFields";
import type { ProcessResult } from "./stageChanged";

/**
 * Shared skeleton of the GHL → server event routes (contract rules 3, 5, 6): authenticate, parse, RECORD the event
 * first, then process. ALWAYS returns 200; failures live in GhlEvent.lastError / attempts and are retried by the
 * replay job. The `reason` field uses the same vocabulary as the jobs route (lib/billing/reason.ts); only the
 * subset that applies here is ever returned.
 *
 * Auth accepts EITHER the x-reiblast-events-secret header OR a `customData.secret` field in the body (both checked
 * timing-safe via the same comparator as the header path) — GHL's standard/default webhook action may not expose
 * custom headers, so a workflow that can only add customData fields still has a way to authenticate. The body must
 * be parsed before auth can be decided (the fallback lives in the body), so parsing happens first here; this only
 * changes behavior when the body is BOTH unparsable AND unauthenticated, which now reports bad_json rather than an
 * auth reason — there was nothing recordable either way. The secret is NEVER logged or stored: redactCustomDataSecret
 * strips `customData.secret` before the payload is persisted to GhlEvent.
 */
const reply = (reason: Reason) => NextResponse.json({ received: reason === "accepted", reason });

export async function handleEventRoute(req: NextRequest, cfg: { label: string; source: string; externalId: (body: Record<string, unknown>) => string | null; process: (eventId: string, db: Awaited<ReturnType<typeof getBillingDb>>) => Promise<ProcessResult> }): Promise<NextResponse> {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn(`[${cfg.label}] invalid JSON body — ignoring`);
      return reply("bad_json");
    }

    if (!process.env.GHL_EVENTS_SECRET) {
      console.error(`[${cfg.label}] missing required env var(s):`, missingEnvVars(["GHL_EVENTS_SECRET"]).join(", "));
      return reply("server_misconfigured");
    }
    const headerSecret = req.headers.get("x-reiblast-events-secret");
    const bodySecret = customDataStringField(body, "secret") ?? null;
    if (!headerSecret && !bodySecret) {
      console.warn(`[${cfg.label}] auth missing — ignoring`);
      return reply("auth_missing");
    }
    const authOk = (headerSecret && secretMatches(headerSecret, "GHL_EVENTS_SECRET")) || (bodySecret && secretMatches(bodySecret, "GHL_EVENTS_SECRET"));
    if (!authOk) {
      console.warn(`[${cfg.label}] auth failed — ignoring`);
      return reply("auth_failed");
    }

    const db = await getBillingDb();
    let event: { id: string };
    try {
      event = await db.ghlEvent.create({ data: { source: cfg.source, externalId: cfg.externalId(body), payload: redactCustomDataSecret(body) as Prisma.InputJsonObject } });
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
