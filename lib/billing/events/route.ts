import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getBillingDb } from "../db";
import { checkSecret, type Reason } from "../reason";
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
      console.error(`[${cfg.label}] GHL_EVENTS_SECRET is not set — refusing`);
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
    const event = await db.ghlEvent.create({ data: { source: cfg.source, externalId: cfg.externalId(body), payload: body as Prisma.InputJsonObject } });
    await cfg.process(event.id, db);
    return reply("accepted");
  } catch (err) {
    console.error(`[${cfg.label}] unexpected error:`, err instanceof Error ? err.message : err);
    return reply("server_misconfigured");
  }
}
