import { Prisma, type PrismaClient } from "@prisma/client";
import { denverDayOf } from "../reports/denver";
import type { BillingState, Decision, Intent } from "../state/types";

/**
 * GHL intents outbox (docs/ghl-server-contract.md rule 2: server → GHL is intent only, via an inbound-webhook workflow).
 * An intent is ALWAYS recorded first. It is only SENT when DUNNING_MODE=live AND the account is allowlisted for live
 * (DUNNING_LIVE_ACCOUNTS); otherwise it is stored as "skipped_shadow" and nothing leaves the server.
 */
export const MAX_INTENT_ATTEMPTS = 5;
/** dedupeKey prefix of a real (CLIENT_HANDOFF=live) Clients handoff intent: `handoff:<ghlAccountId>`. */
export const HANDOFF_DEDUPE_PREFIX = "handoff:";
/** dedupeKey prefix of an onboarding-pipeline intent (lib/billing/onboardingIntents.ts): `onboarding:<ghlAccountId>:<stageKey>`. */
export const ONBOARDING_DEDUPE_PREFIX = "onboarding:";
const SEND_TIMEOUT_MS = 10_000;

export type IntentBody = {
  contactId: string;
  pipeline: "active_client" | "onboarding";
  /** Equals a BillingState value for active_client; an ONBOARDING_STAGE_KEYS value for onboarding. */
  stage: string;
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
          dedupeKey: `${i.mode}:${i.account.id}:${i.trigger}:${kind}:${intent.pipeline === "onboarding" ? "onboarding:" : ""}${intent.stage}`,
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

export type PlacementBody = { contactId: string; pipeline: "active_client" | "onboarding"; stage: string; fields: IntentBody["fields"] };
export type PlacementInput = {
  account: { id: string; contactId: string };
  pipeline: "active_client" | "onboarding";
  /** For active_client this is a BillingState value; for onboarding it's an ONBOARDING_STAGE_KEYS value. Not typed to
   *  either here, since this function serves both. */
  stage: string;
  fields: IntentBody["fields"];
  dedupeKey: string;
  mode: "shadow" | "live";
  sendable: boolean;
};

/**
 * Caller-supplied dedupeKey + stage, same outbox and the same status rules as enqueueIntents (skipped_shadow unless
 * live + allowlisted) — the onboarding pipeline has its own stage keys (lib/billing/onboardingStages.ts), not a
 * BillingState. Used by lib/billing/onboardingIntents.ts (the onboarding webhook routes' new_client /
 * onboarding_form_submitted / sub_account_provisioned intents). A one-off card-placement script for EXISTING
 * opportunities (docs/cutover.md Phase B step 6) would also use this, but isn't built yet.
 */
export async function enqueuePlacementIntent(db: Db, p: PlacementInput): Promise<{ id: string; created: boolean }> {
  const body: PlacementBody = { contactId: p.account.contactId, pipeline: p.pipeline, stage: p.stage, fields: p.fields };
  try {
    const row = await db.ghlIntent.create({
      data: {
        ghlAccountId: p.account.id,
        kind: "stage",
        pipeline: p.pipeline,
        payload: body as unknown as Prisma.InputJsonObject,
        dedupeKey: p.dedupeKey,
        status: p.mode === "live" && p.sendable ? "pending" : "skipped_shadow",
        lastError: p.mode === "live" && !p.sendable ? "account not allowlisted for live (DUNNING_LIVE_ACCOUNTS)" : null,
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already recorded: idempotent
    const existing = await db.ghlIntent.findUnique({ where: { dedupeKey: p.dedupeKey }, select: { id: true } });
    return { id: existing!.id, created: false };
  }
}

export type SendDeps = {
  post?: (url: string, body: unknown) => Promise<{ ok: boolean; status: number; body?: string }>;
  env?: Record<string, string | undefined>;
  /** Overrides the default 10s POST timeout (used by the inline, in-request sends). */
  timeoutMs?: number;
  /** Pause between sends in sendPendingIntents (tests inject a fake). */
  sleep?: (ms: number) => Promise<void>;
};

export const RESPONSE_BODY_MAX = 500;
/** Default pause between consecutive sends in sendPendingIntents, so back-to-back webhook hits never land in the same instant. */
export const DEFAULT_SEND_DELAY_MS = 1500;

async function defaultPost(url: string, body: unknown, timeoutMs = SEND_TIMEOUT_MS): Promise<{ ok: boolean; status: number; body?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: text.slice(0, RESPONSE_BODY_MAX) };
}

/** Send one recorded intent. Only pending/failed rows under the attempt cap are sent; the outcome is written back either way. */
export async function sendIntent(db: Db, id: string, deps: SendDeps = {}): Promise<"sent" | "failed" | "skipped"> {
  const row = await db.ghlIntent.findUnique({ where: { id } });
  if (!row || (row.status !== "pending" && row.status !== "failed") || row.attempts >= MAX_INTENT_ATTEMPTS) return "skipped";
  const url = intentUrl(row.pipeline, deps.env);
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  try {
    if (!url) throw new Error(`no intent URL configured for pipeline ${row.pipeline}`);
    const r = await (deps.post ?? ((u, b) => defaultPost(u, b, deps.timeoutMs)))(url, row.payload);
    responseStatus = r.status;
    responseBody = r.body != null ? r.body.slice(0, RESPONSE_BODY_MAX) : null;
    if (!r.ok) throw new Error(`GHL intent workflow responded HTTP ${r.status}`);
    // lastError is for errors only: a successful send clears it and records the response instead.
    await db.ghlIntent.update({ where: { id }, data: { status: "sent", sentAt: new Date(), lastError: null, responseStatus, responseBody, attempts: { increment: 1 } } });
    return "sent";
  } catch (err) {
    await db.ghlIntent.update({ where: { id }, data: { status: "failed", attempts: { increment: 1 }, responseStatus, responseBody, lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500) } });
    return "failed";
  }
}

/**
 * Send pending intents and retry failed ones (max 5 attempts each). Each family has its own switch:
 *  - engine intents (`live:` dedupeKeys): DUNNING_MODE=live — in shadow mode no engine intent can send;
 *  - onboarding intents (`onboarding:` keys): ONBOARDING_INTENTS=live, regardless of DUNNING_MODE;
 *  - Clients handoff intents (`handoff:` keys): CLIENT_HANDOFF=live, regardless of DUNNING_MODE.
 * Rows go one at a time, oldest first, with a pause between them (opts.delayMs, else INTENT_SEND_DELAY_MS, else 1500ms).
 * Called by the replay job and opportunistically after each processed event.
 */
export async function sendPendingIntents(db: Pick<PrismaClient, "ghlIntent">, opts: { limit?: number; onlyIds?: string[]; deps?: SendDeps; delayMs?: number } = {}): Promise<{ sent: number; failed: number }> {
  const env = opts.deps?.env ?? process.env;
  const dunningLive = (env.DUNNING_MODE ?? "shadow") === "live";
  const keyFilter: Prisma.GhlIntentWhereInput[] = [];
  if (env.ONBOARDING_INTENTS === "live") keyFilter.push({ dedupeKey: { startsWith: ONBOARDING_DEDUPE_PREFIX } });
  if (env.CLIENT_HANDOFF === "live") keyFilter.push({ dedupeKey: { startsWith: HANDOFF_DEDUPE_PREFIX } });
  if (!dunningLive && keyFilter.length === 0) return { sent: 0, failed: 0 };
  const rows = await db.ghlIntent.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      attempts: { lt: MAX_INTENT_ATTEMPTS },
      ...(dunningLive ? {} : { OR: keyFilter }),
      ...(opts.onlyIds ? { id: { in: opts.onlyIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 20,
    select: { id: true },
  });
  let sent = 0, failed = 0;
  const envDelay = Number(env.INTENT_SEND_DELAY_MS);
  const delayMs = opts.delayMs ?? (env.INTENT_SEND_DELAY_MS !== undefined && env.INTENT_SEND_DELAY_MS !== "" && Number.isFinite(envDelay) && envDelay >= 0 ? envDelay : DEFAULT_SEND_DELAY_MS);
  const sleep = opts.deps?.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  for (const [i, r] of rows.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const out = await sendIntent(db, r.id, opts.deps);
    if (out === "sent") sent++;
    else if (out === "failed") failed++;
  }
  return { sent, failed };
}
