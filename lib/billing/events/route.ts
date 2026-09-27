import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getBillingDb } from "../db";
import { secretMatches } from "../secret";
import type { ProcessResult } from "./stageChanged";

/**
 * Shared skeleton of the GHL → server event routes (contract rules 3, 5, 6): authenticate (timing-safe, header
 * x-reiblast-events-secret), parse, RECORD the event first, then process. ALWAYS returns 200; failures live in
 * GhlEvent.lastError / attempts and are retried by the replay job.
 */
const ok = () => NextResponse.json({ received: true });

export async function handleEventRoute(req: NextRequest, cfg: { label: string; source: string; externalId: (body: Record<string, unknown>) => string | null; process: (eventId: string, db: Awaited<ReturnType<typeof getBillingDb>>) => Promise<ProcessResult> }): Promise<NextResponse> {
  try {
    if (!secretMatches(req.headers.get("x-reiblast-events-secret"), "GHL_EVENTS_SECRET")) {
      console.warn(`[${cfg.label}] auth failed — ignoring`);
      return ok();
    }
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn(`[${cfg.label}] invalid JSON body — ignoring`);
      return ok();
    }
    const db = await getBillingDb();
    const event = await db.ghlEvent.create({ data: { source: cfg.source, externalId: cfg.externalId(body), payload: body as Prisma.InputJsonObject } });
    await cfg.process(event.id, db);
  } catch (err) {
    console.error(`[${cfg.label}] unexpected error:`, err instanceof Error ? err.message : err);
  }
  return ok();
}
