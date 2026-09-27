import { Prisma, type PrismaClient } from "@prisma/client";
import { denverDayOf } from "../reports/denver";
import type { BillingState, Decision, Intent } from "../state/types";

/**
 * GHL intents outbox (docs/ghl-server-contract.md rule 2: server → GHL is intent only, via an inbound-webhook workflow).
 * An intent is ALWAYS recorded first. It is only SENT when DUNNING_MODE=live AND the account is allowlisted for live
 * (DUNNING_LIVE_ACCOUNTS); otherwise it is stored as "skipped_shadow" and nothing leaves the server.
 */
export const MAX_INTENT_ATTEMPTS = 5;
const SEND_TIMEOUT_MS = 10_000;

export type IntentBody = {
  contactId: string;
  pipeline: "active_client" | "onboarding";
  /** Equals a BillingState value for active_client. */
  stage: BillingState;
  fields: { pause_reason: string | null; trial_offer: string | null; trial_end_date: string | null };
};

/** What the workflow should end up with. Fields are always the account's CURRENT values so a stage move never blanks the trial fields. */
export function buildIntentBody(p: { contactId: string; intent: Pick<Intent, "pipeline" | "stage">; pauseReason: string | null; trialOffer: string | null; trialEndsAt: Date | null }): IntentBody {
  return {
    contactId: p.contactId,
    pipeline: p.intent.pipeline,
    stage: p.intent.stage,
    fields: { pause_reason: p.pauseReason, trial_offer: p.trialOffer, trial_end_date: p.trialEndsAt ? denverDayOf(p.trialEndsAt) : null },
  };
}

export const intentUrl = (pipeline: string, env: Record<string, string | undefined> = process.env): string | null =>
  (pipeline === "active_client" ? env.GHL_INTENT_URL_ACTIVE_CLIENT : pipeline === "onboarding" ? env.GHL_INTENT_URL_ONBOARDING : undefined) || null;

type Db = Pick<PrismaClient, "ghlIntent">;

export type EnqueueInput = {
  account: { id: string; contactId: string; trialOffer: string | null; trialEndsAt: Date | null };
  trigger: string;
  mode: "shadow" | "live";
  decision: Pick<Decision, "intents" | "pauseReason" | "trialOffer" | "trialEndsAt" | "trialChanged">;
  /** live AND allowlisted → "pending"; anything else → "skipped_shadow". */
  sendable: boolean;
};

/** Record the decision's intents (idempotent on dedupeKey). Returns the ids of rows actually created. */
export async function enqueueIntents(db: Db, i: EnqueueInput): Promise<string[]> {
  const created: string[] = [];
  for (const intent of i.decision.intents) {
    const kind = intent.kind ?? "stage";
    const trialOffer = i.decision.trialChanged ? i.decision.trialOffer : i.account.trialOffer;
    const trialEndsAt = i.decision.trialChanged ? i.decision.trialEndsAt : i.account.trialEndsAt;
    const body = buildIntentBody({ contactId: i.account.contactId, intent, pauseReason: i.decision.pauseReason, trialOffer, trialEndsAt });
    try {
      const row = await db.ghlIntent.create({
        data: {
          ghlAccountId: i.account.id,
          kind,
          pipeline: intent.pipeline,
          payload: body as unknown as Prisma.InputJsonObject,
          dedupeKey: `${i.mode}:${i.account.id}:${i.trigger}:${kind}:${intent.stage}`,
          status: i.mode === "live" && i.sendable ? "pending" : "skipped_shadow",
          lastError: i.mode === "live" && !i.sendable ? "account not allowlisted for live (DUNNING_LIVE_ACCOUNTS)" : null,
        },
        select: { id: true },
      });
      created.push(row.id);
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already recorded: idempotent
    }
  }
  return created;
}

export type SendDeps = { post?: (url: string, body: unknown) => Promise<{ ok: boolean; status: number }>; env?: Record<string, string | undefined> };

async function defaultPost(url: string, body: unknown): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status };
}

/** Send one recorded intent. Only pending/failed rows under the attempt cap are sent; the outcome is written back either way. */
export async function sendIntent(db: Db, id: string, deps: SendDeps = {}): Promise<"sent" | "failed" | "skipped"> {
  const row = await db.ghlIntent.findUnique({ where: { id } });
  if (!row || (row.status !== "pending" && row.status !== "failed") || row.attempts >= MAX_INTENT_ATTEMPTS) return "skipped";
  const url = intentUrl(row.pipeline, deps.env);
  try {
    if (!url) throw new Error(`no intent URL configured for pipeline ${row.pipeline}`);
    const r = await (deps.post ?? defaultPost)(url, row.payload);
    if (!r.ok) throw new Error(`GHL intent workflow responded HTTP ${r.status}`);
    await db.ghlIntent.update({ where: { id }, data: { status: "sent", sentAt: new Date(), lastError: null, attempts: { increment: 1 } } });
    return "sent";
  } catch (err) {
    await db.ghlIntent.update({ where: { id }, data: { status: "failed", attempts: { increment: 1 }, lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500) } });
    return "failed";
  }
}

/**
 * Send pending intents and retry failed ones (max 5 attempts each). Hard-gated: it does NOTHING unless DUNNING_MODE=live, so in
 * shadow mode no code path can send. Called by the replay job and opportunistically after each processed event.
 */
export async function sendPendingIntents(db: Pick<PrismaClient, "ghlIntent">, opts: { limit?: number; onlyIds?: string[]; deps?: SendDeps } = {}): Promise<{ sent: number; failed: number }> {
  const env = opts.deps?.env ?? process.env;
  if ((env.DUNNING_MODE ?? "shadow") !== "live") return { sent: 0, failed: 0 };
  const rows = await db.ghlIntent.findMany({
    where: { status: { in: ["pending", "failed"] }, attempts: { lt: MAX_INTENT_ATTEMPTS }, ...(opts.onlyIds ? { id: { in: opts.onlyIds } } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 20,
    select: { id: true },
  });
  let sent = 0, failed = 0;
  for (const r of rows) {
    const out = await sendIntent(db, r.id, opts.deps);
    if (out === "sent") sent++;
    else if (out === "failed") failed++;
  }
  return { sent, failed };
}
