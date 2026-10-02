import { Prisma, type PrismaClient } from "@prisma/client";
import { executeEffects, type SideEffectResult } from "./effects";
import { enqueueIntents, sendPendingIntents, type SendDeps } from "../intents/send";
import { readBalance } from "./balance";
import { eventFromLedger } from "./events";
import { loadProjection, seedFromAccount, type Projection } from "./projection";
import { fetchSubscription } from "./subscription";
import { decide, needsBalance, needsSubscription } from "./transition";
import type { BalanceReading, BillingState, Context, Decision, DunningEvent, SubscriptionInfo } from "./types";

/**
 * THE shared write path for dunning decisions.
 *
 *  - SHADOW / REPLAY (default): records a DunningDecision (and, for shadow, GhlIntent rows as "skipped_shadow"). Nothing else: no
 *    GhlAccount / User write, no SaaS pause/resume, no GHL call.
 *  - LIVE (built, unreachable unless DUNNING_MODE=live): ONE transaction persists the GhlAccount (and User) state, writes the
 *    decision and enqueues intents; AFTER the commit it sends the intents and executes the side effects. Even then it acts only for
 *    accounts named in DUNNING_LIVE_ACCOUNTS — any other account is processed as shadow.
 *
 * Contract rule 5: the decision row is the record; reprocessing the same (trigger, account, mode) is a no-op.
 */
export type Mode = "shadow" | "replay" | "live";

/** DUNNING_MODE (default "shadow"). Only "shadow" and "live" are valid; anything else throws. */
export function dunningMode(env: Record<string, string | undefined> = process.env): "shadow" | "live" {
  const m = env.DUNNING_MODE ?? "shadow";
  if (m !== "shadow" && m !== "live") throw new Error(`DUNNING_MODE=${m} is not supported: use "shadow" (default) or "live"`);
  return m;
}

/** DUNNING_LIVE_ACCOUNTS: comma-separated GhlAccount ids and/or locationIds live mode may act on. Empty (default) = nobody. */
export function liveAllowlist(env: Record<string, string | undefined> = process.env): string[] {
  return (env.DUNNING_LIVE_ACCOUNTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
export const isLiveAllowed = (a: { id: string; locationId: string | null }, env: Record<string, string | undefined> = process.env): boolean => {
  const list = liveAllowlist(env);
  return list.includes(a.id) || (!!a.locationId && list.includes(a.locationId));
};

/** User.status while User remains the live gate (removable after the tools repoint): paused → suspended; inactive/churned → inactive. */
export const userStatusFor = (s: BillingState | null): "active" | "suspended" | "inactive" | null =>
  s === null ? null : s === "paused" ? "suspended" : s === "inactive" || s === "churned" ? "inactive" : "active";
/** Only these User.status values are ever overwritten — never the onboarding statuses. */
export const MANAGED_USER_STATUSES = ["active", "suspended", "inactive"] as const;

export const SHADOW_MAX_AGE_MS = 48 * 3600 * 1000;

export type ApplyInput = { ghlAccountId: string; trigger: string; event: DunningEvent; eventAt: Date; subscriptionId?: string | null; /** supplied by the sweep: no fetch needed */ subscriptionInfo?: SubscriptionInfo | null };
export type ApplyDeps = {
  readBalance?: (locationId: string | null | undefined) => Promise<BalanceReading>;
  readSubscription?: (subscriptionId: string) => Promise<SubscriptionInfo | null>;
  now?: () => Date;
  maxAgeMs?: number;
  /** live only */
  pause?: (locationId: string) => Promise<void>;
  unpause?: (locationId: string) => Promise<void>;
  send?: SendDeps;
  env?: Record<string, string | undefined>;
};
export type ApplyResult =
  | { status: "recorded"; decision: Decision; balance?: BalanceReading; mode: Mode; executed?: SideEffectResult[] }
  | { status: "duplicate" }
  | { status: "skipped"; why: string };
export type { SideEffectResult };

type Db = PrismaClient;
const isUnique = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** The row for one decision (shared by shadow, replay and live so all write identical shapes). */
export function decisionRow(input: { ghlAccountId: string; trigger: string; eventAt: Date; event: DunningEvent; from: Pick<Projection, "state" | "strikes">; decision: Decision; mode: Mode; balance?: BalanceReading }) {
  const b = input.balance && input.balance.status === "ok" ? input.balance : null;
  return {
    ghlAccountId: input.ghlAccountId,
    trigger: input.trigger,
    eventKind: input.event.kind,
    eventAt: input.eventAt,
    fromState: input.from.state,
    toState: input.decision.nextState,
    fromStrikes: input.from.strikes,
    toStrikes: input.decision.warningCount,
    pauseReason: input.decision.pauseReason,
    coreFailureOpen: input.decision.coreFailureOpen,
    sideEffects: input.decision.sideEffects as unknown as Prisma.InputJsonValue,
    intents: input.decision.intents as unknown as Prisma.InputJsonValue,
    reason: input.decision.reason,
    mode: input.mode,
    walletBalance: b ? new Prisma.Decimal(b.value) : null,
    balanceEstimated: b ? b.estimated : false,
  };
}

/** Insert one decision row; a repeat of the same (trigger, account, mode) is a no-op ("duplicate"). */
export async function recordDecision(db: Pick<PrismaClient, "dunningDecision">, row: ReturnType<typeof decisionRow>): Promise<"recorded" | "duplicate"> {
  try {
    await db.dunningDecision.create({ data: row });
    return "recorded";
  } catch (e) {
    if (isUnique(e)) return "duplicate";
    throw e;
  }
}

/** Live snapshot: the persisted account is authoritative for state/strikes/pause reason; the open-core-failure flag comes from the latest LIVE decision (else inferred). */
async function loadLiveSnapshot(db: Pick<PrismaClient, "dunningDecision" | "ghlAccount">, id: string): Promise<Projection | null> {
  const a = await db.ghlAccount.findUnique({ where: { id }, select: { billingState: true, warningCount: true, pauseReason: true } });
  if (!a) return null;
  const last = await db.dunningDecision.findFirst({ where: { ghlAccountId: id, mode: "live" }, orderBy: [{ eventAt: "desc" }, { createdAt: "desc" }], select: { coreFailureOpen: true, eventAt: true } });
  const base = seedFromAccount(a);
  return last ? { ...base, coreFailureOpen: last.coreFailureOpen, source: "decision", lastEventAt: last.eventAt } : base;
}

/**
 * Decide and record ONE event for an account.
 * Balance / subscription reads (GET only) happen only when the rule needs them and never inside the DB transaction; the
 * transaction holds a per-account advisory lock so two events for one account can't interleave their projection read and write.
 */
export async function applyDunning(db: Db, input: ApplyInput, opts: { mode?: Mode; deps?: ApplyDeps } = {}): Promise<ApplyResult> {
  const requested = opts.mode ?? dunningMode();
  const deps = opts.deps ?? {};
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();

  const account = await db.ghlAccount.findUnique({
    where: { id: input.ghlAccountId },
    select: { id: true, accountType: true, contactId: true, locationId: true, coreCoveredUntil: true, trialOffer: true, trialEndsAt: true, userId: true, activeClientSince: true, onboardingProgress: true },
  });
  if (!account) return { status: "skipped", why: "account not found" };
  if (account.accountType !== "member") return { status: "skipped", why: "not a member account" };

  // Live only for allowlisted accounts; every other account is processed exactly as shadow (record only, nothing executed).
  const live = requested === "live" && isLiveAllowed(account, env);
  const mode: Mode = requested === "live" && !live ? "shadow" : requested;

  const dupWhere = { trigger_ghlAccountId_mode: { trigger: input.trigger, ghlAccountId: input.ghlAccountId, mode } };
  if (await db.dunningDecision.findUnique({ where: dupWhere, select: { id: true } })) return { status: "duplicate" };

  if (mode !== "replay" && now.getTime() - input.eventAt.getTime() > (deps.maxAgeMs ?? SHADOW_MAX_AGE_MS)) {
    return { status: "skipped", why: "historical event (older than 48h): covered by replay, not the live pipeline" };
  }

  const load = (client: Pick<PrismaClient, "dunningDecision" | "ghlAccount">) => (live ? loadLiveSnapshot(client, input.ghlAccountId) : loadProjection(client, input.ghlAccountId, mode === "replay" ? "replay" : "shadow"));
  const initial = await load(db);
  if (!initial) return { status: "skipped", why: "account not found" };
  if (mode !== "replay" && initial.lastEventAt && input.eventAt.getTime() < initial.lastEventAt.getTime()) {
    return { status: "skipped", why: "out of order: a later event is already projected" };
  }

  // External reads — only what this event needs, and outside the transaction.
  let balance: BalanceReading | undefined;
  if (needsBalance(initial, input.event)) balance = await (deps.readBalance ?? readBalance)(account.locationId);
  let subscription: SubscriptionInfo | null | undefined = input.subscriptionInfo;
  if (subscription === undefined && needsSubscription(initial, input.event)) {
    try {
      subscription = input.subscriptionId ? await (deps.readSubscription ?? fetchSubscription)(input.subscriptionId) : null;
    } catch {
      subscription = null;
    }
  }

  let committed: { decision: Decision; balance?: BalanceReading; decisionId: string; intentIds: string[] };
  try {
    committed = await db.$transaction(async (tx) => {
      // Serialize per account (SELECT 1 FROM (…) so Prisma never has to deserialize the void return of pg_advisory_xact_lock).
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${input.ghlAccountId}))) AS t`;
      if (await tx.dunningDecision.findUnique({ where: dupWhere, select: { id: true } })) throw new DuplicateSignal();
      const cur: Projection = (await load(tx as unknown as PrismaClient)) ?? initial;
      // The projection may have moved while we were reading; a read we didn't make degrades to "unknown", never to a guess.
      let reading = balance;
      if (needsBalance(cur, input.event) && !reading) reading = { status: "unknown", why: "state changed while processing" };
      const ctx: Context = { now: mode === "replay" ? input.eventAt : now, coveredUntil: account.coreCoveredUntil, walletBalance: reading, subscription, routing: { handedOff: !!account.activeClientSince, onboardingProgress: account.onboardingProgress } };
      const decision = decide(cur, input.event, ctx);
      const row = await tx.dunningDecision.create({
        data: decisionRow({ ghlAccountId: input.ghlAccountId, trigger: input.trigger, eventAt: input.eventAt, event: input.event, from: cur, decision, mode, balance: reading }),
        select: { id: true },
      });

      let intentIds: string[] = [];
      if (live) {
        // LIVE: persist the account (authoritative) and, while User is still the live gate, the User mirror — in the same transaction.
        await tx.ghlAccount.update({
          where: { id: input.ghlAccountId },
          data: { billingState: decision.nextState, warningCount: decision.warningCount, pauseReason: decision.pauseReason, ...(decision.trialChanged ? { trialOffer: decision.trialOffer, trialEndsAt: decision.trialEndsAt } : {}) },
        });
        const userStatus = userStatusFor(decision.nextState);
        await tx.user.updateMany({ where: { id: account.userId }, data: { warningCount: decision.warningCount } });
        if (userStatus) await tx.user.updateMany({ where: { id: account.userId, status: { in: [...MANAGED_USER_STATUSES] } }, data: { status: userStatus } });
      }
      if (mode === "shadow" || mode === "live") {
        intentIds = await enqueueIntents(tx, { account, trigger: input.trigger, mode, decision, sendable: live });
      }
      return { decision, balance: reading, decisionId: row.id, intentIds };
    });
  } catch (e) {
    if (e instanceof DuplicateSignal || isUnique(e)) return { status: "duplicate" };
    throw e;
  }

  // AFTER commit (live only): execute the side effects, then send the intents. Failures are recorded, never rolled back.
  let executed: SideEffectResult[] | undefined;
  if (live) {
    if (committed.decision.sideEffects.length) {
      executed = await executeEffects(committed.decision.sideEffects, account.locationId, deps);
      await db.dunningDecision.update({ where: { id: committed.decisionId }, data: { sideEffects: executed as unknown as Prisma.InputJsonValue } });
    }
    if (committed.intentIds.length) await sendPendingIntents(db, { onlyIds: committed.intentIds, deps: { ...deps.send, env } });
  }
  return { status: "recorded", decision: committed.decision, balance: committed.balance, mode, executed };
}

class DuplicateSignal extends Error {}

/** Load a ledger row, map it to an engine event, and apply it. Rows with no rule (or a non-terminal status) are skipped, not recorded. */
export async function applyFromLedger(db: Db, ghlTransactionId: string, opts: { mode?: Mode; deps?: ApplyDeps } = {}): Promise<ApplyResult> {
  const row = await db.billingLedgerEntry.findUnique({
    where: { ghlTransactionId },
    select: { ghlTransactionId: true, classification: true, status: true, ghlAccountId: true, occurredAt: true, subscriptionId: true },
  });
  if (!row) return { status: "skipped", why: "ledger row not found" };
  const m = eventFromLedger(row);
  if (!m.ok) return { status: "skipped", why: m.skip };
  return applyDunning(db, { ghlAccountId: row.ghlAccountId as string, trigger: m.value.trigger, event: m.value.event, eventAt: m.value.eventAt, subscriptionId: m.value.subscriptionId }, opts);
}

const ERR_JOB = "dunning_shadow";

/** Record a hook failure where the admin Health page can see it (JobRun "dunning_shadow"; not one of the scheduled jobs). */
export async function recordShadowError(db: Pick<PrismaClient, "jobRun">, err: unknown, where: string): Promise<void> {
  try {
    const message = `${where}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
    const prev = await db.jobRun.findUnique({ where: { job: ERR_JOB }, select: { lastSummary: true } });
    const n = Number((prev?.lastSummary as { errors?: number } | null)?.errors ?? 0) + 1;
    const summary = { errors: n, lastErrorAt: new Date().toISOString() };
    await db.jobRun.upsert({ where: { job: ERR_JOB }, create: { job: ERR_JOB, lastError: message, lastSummary: summary }, update: { lastError: message, lastSummary: summary } });
  } catch (inner) {
    console.error("[dunning-shadow] could not record error:", inner instanceof Error ? inner.message : inner);
  }
}

/**
 * The hook called after a ledger row is ingested. NEVER throws and never affects the caller: any error (including an unsupported
 * DUNNING_MODE) is caught, logged and recorded; the webhook's 200, the ledger write and the event's processedAt are untouched.
 * It runs in the configured DUNNING_MODE (shadow by default).
 */
export async function shadowDunningForLedger(db: PrismaClient, ghlTransactionId: string, opts: { deps?: ApplyDeps } = {}): Promise<ApplyResult | null> {
  try {
    const mode = dunningMode(opts.deps?.env);
    const r = await applyFromLedger(db, ghlTransactionId, { mode, deps: opts.deps });
    return r;
  } catch (err) {
    console.error("[dunning-shadow] failed for", ghlTransactionId, err instanceof Error ? err.message : err);
    await recordShadowError(db, err, `ledger:${ghlTransactionId}`);
    return null;
  }
}
