import type { Prisma, PrismaClient } from "@prisma/client";
import { applyDunning, dunningMode, type ApplyDeps } from "../state/apply";
import type { BillingState, DunningEvent } from "../state/types";
import { isForwardProgress, isKnownOnboardingStage } from "../stages";
import { customDataField } from "./payloadFields";

/**
 * GHL "stage changed" webhook → GhlEvent (source "stage_change") → engine command / onboarding progress tracking.
 *
 * Payload contract this code expects from GHL's default "pipeline stage changed" workflow (documented here since
 * downstream GHL config must match it exactly — see docs/oct1-release.md): GHL's STANDARD webhook action body, with
 * our fields added as customData:
 *   { ...GHL's default fields..., "customData": { "contactId": "<GHL contact id, 8-64 alphanumeric chars>", "pipeline": "active_client" | "onboarding", "stage": "<exact opportunity stage name>" } }
 * `contactId`/`pipeline`/`stage` are read from `customData` first, falling back to a flat top-level field of the
 * same name so a manual/curl test posting flat JSON still works. "stage" is the opportunity's new stage NAME (not an
 * id) — for the onboarding pipeline it must be one of lib/billing/stages.ts ONBOARDING_STAGE_NAMES; for
 * active_client, one of BILLING_STAGES below (or "paused_confirm").
 */
export const BILLING_STAGES: BillingState[] = ["trial", "active", "payment_failed", "paused", "inactive", "churned"];
export const PAUSE_CONFIRM_STAGE = "paused_confirm";
/** A repeat of the same (contact, pipeline, stage) within this window is a duplicate delivery. */
export const DUPLICATE_WINDOW_MS = 60_000;

export type StagePayload = { contactId: string; pipeline: "active_client" | "onboarding"; stage: string };

export function parseStagePayload(p: unknown): { ok: true; value: StagePayload } | { ok: false; why: string } {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return { ok: false, why: "payload is not an object" };
  const o = p as Record<string, unknown>;
  const rawContactId = customDataField(o, "contactId");
  const rawStage = customDataField(o, "stage");
  const rawPipeline = customDataField(o, "pipeline");
  const contactId = typeof rawContactId === "string" ? rawContactId.trim() : "";
  const stage = typeof rawStage === "string" ? rawStage.trim() : "";
  if (!/^[A-Za-z0-9]{8,64}$/.test(contactId)) return { ok: false, why: "invalid contactId" };
  if (rawPipeline !== "active_client" && rawPipeline !== "onboarding") return { ok: false, why: "unknown pipeline" };
  if (!stage || stage.length > 120) return { ok: false, why: "invalid stage" };
  return { ok: true, value: { contactId, pipeline: rawPipeline, stage } };
}

/** active_client stage → engine event: "paused_confirm" is the confirmation, a BillingState key is a command, anything else is ignored. */
export function eventForStage(stage: string): DunningEvent | null {
  if (stage === PAUSE_CONFIRM_STAGE) return { kind: "pause_confirmed" };
  return (BILLING_STAGES as string[]).includes(stage) ? { kind: "command", stage: stage as BillingState } : null;
}

export type ProcessResult = "processed" | "failed" | "already_processed" | "not_found";

/** Process one recorded stage_change event. Never throws: failures increment attempts and store lastError (replay retries them). */
export async function processStageChanged(eventId: string, opts: { db: PrismaClient; deps?: ApplyDeps }): Promise<ProcessResult> {
  const { db } = opts;
  const event = await db.ghlEvent.findUnique({ where: { id: eventId } });
  if (!event) return "not_found";
  if (event.processedAt) return "already_processed";

  const done = (note: string | null) => db.ghlEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: note } });
  try {
    const parsed = parseStagePayload(event.payload);
    if (!parsed.ok) {
      await done(`ignored: ${parsed.why}`);
      return "processed";
    }
    const { contactId, pipeline, stage } = parsed.value;

    const account = await db.ghlAccount.findFirst({ where: { contactId, accountType: "member" }, select: { id: true, onboardingStage: true, onboardingProgress: true } });
    if (!account) {
      await done("ignored: no member account for this contact");
      return "processed";
    }

    // A repeat delivery of the same move within a minute is not a second command. Only the MOST RECENT earlier event counts, so a
    // genuine paused → active → paused sequence is never mistaken for a duplicate.
    const [latest] = await db.ghlEvent.findMany({
      where: { source: "stage_change", externalId: contactId, id: { not: event.id }, processedAt: { not: null }, receivedAt: { gte: new Date(event.receivedAt.getTime() - DUPLICATE_WINDOW_MS) } },
      orderBy: { receivedAt: "desc" },
      select: { payload: true },
      take: 1,
    });
    const prior = latest ? parseStagePayload(latest.payload) : null;
    if (prior && prior.ok && prior.value.pipeline === pipeline && prior.value.stage === stage) {
      await done("ignored: duplicate delivery within 60 s");
      return "processed";
    }

    if (pipeline === "onboarding") {
      // onboardingStage is always updated: a current-stage display field GHL owns (includes side stages), exactly as
      // before this change — unrecognized values are not withheld from it.
      const data: Prisma.GhlAccountUpdateInput = {};
      if (account.onboardingStage !== stage) data.onboardingStage = stage;
      // onboardingProgress only ever moves forward, and side stages (Payment Failed/Paused/Blocker Detected) never touch it.
      if (isForwardProgress(account.onboardingProgress, stage)) {
        data.onboardingProgress = stage;
        data.onboardingProgressAt = event.receivedAt;
      }
      if (Object.keys(data).length > 0) await db.ghlAccount.update({ where: { id: account.id }, data });

      // Unrecognized stage name: never guess-map it into progress. Record it separately for investigation.
      if (!isKnownOnboardingStage(stage)) {
        await db.ghlEvent.create({ data: { source: "stage_change_unmapped", externalId: contactId, payload: event.payload as Prisma.InputJsonValue } });
        await done(`ignored for progress: unrecognized onboarding stage "${stage}" (recorded for investigation; onboardingStage display field still updated)`);
        return "processed";
      }

      await done(null);
      return "processed";
    }

    const dunningEvent = eventForStage(stage);
    if (!dunningEvent) {
      await done(`ignored: stage "${stage}" is not a billing stage`);
      return "processed";
    }
    await applyDunning(db, { ghlAccountId: account.id, trigger: `command:${stage}:${event.id}`, event: dunningEvent, eventAt: event.receivedAt }, { mode: dunningMode(opts.deps?.env), deps: opts.deps });
    await done(null);
    return "processed";
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error("[stage-changed] processing failed:", message);
    await db.ghlEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: message } });
    return "failed";
  }
}
