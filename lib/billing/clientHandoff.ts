import type { Prisma, PrismaClient } from "@prisma/client";
import { denverDayOf } from "./reports/denver";
import { enqueuePlacementIntent, HANDOFF_DEDUPE_PREFIX, sendIntent, type SendDeps } from "./intents/send";

/**
 * Onboarding → Clients handoff. When a member's onboarding progress first reaches A2P Approved (the onboarding stage-changed
 * webhook), the server enqueues ONE active_client intent — the same receiver and body as every other Clients intent, whose
 * workflow creates-or-updates the opportunity in the Clients pipeline — placing the card by the account's billingState:
 * trial → Trial, active → Active Member, payment_failed → Payment Failed, paused → Paused (inactive/churned → Inactive/Churned).
 * A null billingState gets NO intent; it is recorded for review (GhlEvent "client_handoff_review") and activeClientSince stays null.
 *
 * Gated by CLIENT_HANDOFF=live|off (default off), independent of DUNNING_MODE and of DUNNING_LIVE_ACCOUNTS:
 *  - live: sets GhlAccount.activeClientSince (the engine then routes this member's billing intents to Clients), records the intent as
 *    pending (dedupeKey `handoff:<ghlAccountId>`) and sends it.
 *  - off:  records the intent as skipped_shadow under `handoff-shadow:<ghlAccountId>` (a preview) and writes NOTHING else — in particular
 *    activeClientSince stays null, so a later CLIENT_HANDOFF=live can still hand the member off.
 * Idempotent: an account with activeClientSince set is never handed off again, and both dedupe keys are unique.
 */
export function clientHandoffMode(env: Record<string, string | undefined> = process.env): "live" | "off" {
  return env.CLIENT_HANDOFF === "live" ? "live" : "off";
}

export const HANDOFF_TRIGGER_STAGE = "A2P Approved";

export type HandoffResult =
  | { status: "handed_off"; stage: string; intentId: string; sent: "sent" | "failed" | "skipped" }
  | { status: "shadow"; stage: string; intentId: string }
  | { status: "already_handed_off" }
  | { status: "no_billing_state" }
  | { status: "not_found" };

type Db = Pick<PrismaClient, "ghlAccount" | "ghlIntent" | "ghlEvent">;

export async function handoffToClients(db: Db, ghlAccountId: string, opts: { env?: Record<string, string | undefined>; now?: Date; send?: SendDeps } = {}): Promise<HandoffResult> {
  const env = opts.env ?? process.env;
  const a = await db.ghlAccount.findUnique({
    where: { id: ghlAccountId },
    select: { id: true, contactId: true, accountType: true, billingState: true, pauseReason: true, trialOffer: true, trialEndsAt: true, activeClientSince: true },
  });
  if (!a || a.accountType !== "member") return { status: "not_found" };
  if (a.activeClientSince) return { status: "already_handed_off" };
  if (!a.billingState) {
    await db.ghlEvent.create({
      data: { source: "client_handoff_review", externalId: a.contactId, payload: { ghlAccountId: a.id, reason: "reached A2P Approved with a null billingState — no Clients intent sent" } as Prisma.InputJsonObject },
    });
    return { status: "no_billing_state" };
  }

  const fields = { pause_reason: a.pauseReason, trial_offer: a.trialOffer, trial_end_date: a.trialEndsAt ? denverDayOf(a.trialEndsAt) : null };
  const base = { account: { id: a.id, contactId: a.contactId }, pipeline: "active_client" as const, stage: a.billingState, fields };

  if (clientHandoffMode(env) !== "live") {
    const r = await enqueuePlacementIntent(db, { ...base, dedupeKey: `handoff-shadow:${a.id}`, mode: "shadow", sendable: false });
    return { status: "shadow", stage: a.billingState, intentId: r.id };
  }

  // Record the intent first (idempotent on its dedupeKey), then claim the handoff atomically so two deliveries can't both send it.
  // A failure between the two leaves activeClientSince null and a pending row — the event retry just claims and sends.
  const r = await enqueuePlacementIntent(db, { ...base, dedupeKey: `${HANDOFF_DEDUPE_PREFIX}${a.id}`, mode: "live", sendable: true });
  const claimed = await db.ghlAccount.updateMany({ where: { id: a.id, activeClientSince: null }, data: { activeClientSince: opts.now ?? new Date() } });
  if (claimed.count === 0) return { status: "already_handed_off" };
  const sent = await sendIntent(db, r.id, { ...opts.send, env });
  return { status: "handed_off", stage: a.billingState, intentId: r.id, sent };
}
