import type { PrismaClient } from "@prisma/client";
import { clientHandoffMode, handoffStageFor, handoffToClients, HANDOFF_TRIGGER_STAGE, type HandoffResult } from "./clientHandoff";
import type { SendDeps } from "./intents/send";

/**
 * Catch-up handoff for members who reached A2P Approved while their billingState was null. Each was recorded as a GhlEvent
 * "client_handoff_review" and never handed off (activeClientSince stays null, and no new A2P Approved event will arrive). Once
 * sub_sweep (or a payment event) has seeded their state, the ordinary handoff can run for them.
 *
 * `planCatchup` is read-only: it lists who would be handed off and where, and who is still unseeded. `runCatchup` performs the
 * handoffs (CLIENT_HANDOFF must be "live") for the ready ones only, through the same idempotent `handoffToClients`.
 */
export type CatchupRow = {
  ghlAccountId: string;
  contactId: string;
  billingState: string | null;
  /** The Clients stage the handoff would place the card in (null while unseeded). */
  stage: string | null;
  status: "ready" | "unseeded" | "not_at_a2p_approved";
};
type Db = Pick<PrismaClient, "ghlAccount" | "ghlIntent" | "ghlEvent">;

export async function planCatchup(db: Db): Promise<CatchupRow[]> {
  const events = await db.ghlEvent.findMany({ where: { source: "client_handoff_review" }, select: { payload: true } });
  const ids = [...new Set(events.map((e) => (e.payload as { ghlAccountId?: unknown } | null)?.ghlAccountId).filter((x): x is string => typeof x === "string"))];
  if (ids.length === 0) return [];
  const accounts = await db.ghlAccount.findMany({
    where: { id: { in: ids }, accountType: "member", activeClientSince: null },
    select: { id: true, contactId: true, billingState: true, pauseReason: true, onboardingProgress: true },
  });
  return accounts
    .map((a): CatchupRow => ({
      ghlAccountId: a.id,
      contactId: a.contactId,
      billingState: a.billingState,
      stage: a.billingState ? handoffStageFor({ billingState: a.billingState, pauseReason: a.pauseReason }) : null,
      status: a.onboardingProgress !== HANDOFF_TRIGGER_STAGE ? "not_at_a2p_approved" : a.billingState ? "ready" : "unseeded",
    }))
    .sort((x, y) => x.ghlAccountId.localeCompare(y.ghlAccountId));
}

export async function runCatchup(db: Db, opts: { env?: Record<string, string | undefined>; send?: SendDeps } = {}): Promise<{ results: { ghlAccountId: string; result: HandoffResult }[] }> {
  if (clientHandoffMode(opts.env) !== "live") throw new Error("CLIENT_HANDOFF is not live: refusing to hand off (it would only record previews). Set CLIENT_HANDOFF=live.");
  const plan = await planCatchup(db);
  const results: { ghlAccountId: string; result: HandoffResult }[] = [];
  for (const row of plan.filter((r) => r.status === "ready")) results.push({ ghlAccountId: row.ghlAccountId, result: await handoffToClients(db, row.ghlAccountId, opts) });
  return { results };
}
