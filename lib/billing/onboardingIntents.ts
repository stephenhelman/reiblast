import type { PrismaClient } from "@prisma/client";
import { enqueuePlacementIntent, sendIntent, type SendDeps } from "./intents/send";
import type { OnboardingStageKey } from "./onboardingStages";

/**
 * Gate for the NEW onboarding intents (new_client / onboarding_form_submitted / sub_account_provisioned), reusing the
 * existing GhlIntent outbox (lib/billing/intents/send.ts) but on a SEPARATE env var from DUNNING_MODE — onboarding
 * intents must never piggyback on the dunning live/shadow gate. "live" sends; anything else (including unset) is off,
 * i.e. recorded as skipped_shadow and never sent — same shape as DUNNING_MODE=shadow, but independently controlled.
 */
export function onboardingIntentsMode(env: Record<string, string | undefined> = process.env): "live" | "off" {
  return env.ONBOARDING_INTENTS === "live" ? "live" : "off";
}

type Db = Pick<PrismaClient, "ghlIntent">;

/**
 * Enqueue one onboarding-pipeline intent (deduped once per member via dedupeKey `onboarding:<ghlAccountId>:<stageKey>`).
 * Gated by ONBOARDING_INTENTS, independent of DUNNING_MODE.
 */
export async function enqueueOnboardingIntent(
  db: Db,
  p: { account: { id: string; contactId: string }; stageKey: OnboardingStageKey; env?: Record<string, string | undefined> },
): Promise<{ id: string; created: boolean }> {
  const mode = onboardingIntentsMode(p.env);
  return enqueuePlacementIntent(db, {
    account: p.account,
    pipeline: "onboarding",
    stage: p.stageKey,
    fields: { pause_reason: null, trial_offer: null, trial_end_date: null },
    dedupeKey: `onboarding:${p.account.id}:${p.stageKey}`,
    mode: mode === "live" ? "live" : "shadow",
    sendable: mode === "live",
  });
}

/** Short in-request timeout: the routes await this before responding, so it must not hang a webhook. */
export const INLINE_SEND_TIMEOUT_MS = 5_000;

/**
 * Record an onboarding intent and, when ONBOARDING_INTENTS=live, send it inline and awaited (the response is not allowed
 * to finish first — Vercel can freeze the function after it). Never throws: any failure is logged and the intent stays
 * pending/failed for sendPendingIntents / the replay job to retry, so callers (webhooks) can still return 200.
 * An already-recorded intent that is still pending/failed is re-attempted; a sent one is a no-op (sendIntent skips it).
 */
export async function enqueueAndSendOnboardingIntent(
  db: Db,
  p: { account: { id: string; contactId: string }; stageKey: OnboardingStageKey; env?: Record<string, string | undefined>; send?: SendDeps },
): Promise<{ id?: string; sent: "sent" | "failed" | "skipped" | "off" | "error" }> {
  try {
    const { id } = await enqueueOnboardingIntent(db, p);
    if (onboardingIntentsMode(p.env) !== "live") return { id, sent: "off" };
    const sent = await sendIntent(db, id, { timeoutMs: INLINE_SEND_TIMEOUT_MS, ...p.send, env: p.env ?? p.send?.env });
    return { id, sent };
  } catch (e) {
    console.error(`[onboarding-intent] ${p.stageKey} enqueue/send failed:`, e instanceof Error ? e.message : e);
    return { sent: "error" };
  }
}
