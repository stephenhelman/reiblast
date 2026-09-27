import { Prisma, type PrismaClient } from "@prisma/client";
import { readBalance } from "./balance";
import { eventFromLedger } from "./events";
import { loadProjection, type Projection } from "./projection";
import { fetchSubscription } from "./subscription";
import { decide, needsBalance, needsSubscription } from "./transition";
import type { BalanceReading, Context, Decision, DunningEvent, SubscriptionInfo } from "./types";

/**
 * THE shared write path for dunning decisions. In this task it runs in SHADOW (or replay) mode only: it records a DunningDecision
 * row and NOTHING else — no GhlAccount update, no SaaS pause/resume, no GHL write, no intent sent. The `live` branch (7b) is a stub
 * that throws. Contract rule 5: the decision row is the record; reprocessing the same (trigger, account, mode) is a no-op.
 */
export type Mode = "shadow" | "replay" | "live";

/** DUNNING_MODE (default "shadow"). Any other value throws in this task. */
export function dunningMode(env: Record<string, string | undefined> = process.env): "shadow" {
  const m = env.DUNNING_MODE ?? "shadow";
  if (m !== "shadow") throw new Error(`DUNNING_MODE=${m} is not supported yet: only "shadow" is implemented in this release`);
  return "shadow";
}

export const SHADOW_MAX_AGE_MS = 48 * 3600 * 1000;

export type ApplyInput = { ghlAccountId: string; trigger: string; event: DunningEvent; eventAt: Date; subscriptionId?: string | null };
export type ApplyDeps = {
  readBalance?: (locationId: string | null | undefined) => Promise<BalanceReading>;
  readSubscription?: (subscriptionId: string) => Promise<SubscriptionInfo | null>;
  now?: () => Date;
  maxAgeMs?: number;
};
export type ApplyResult = { status: "recorded"; decision: Decision; balance?: BalanceReading } | { status: "duplicate" } | { status: "skipped"; why: string };

type Db = PrismaClient;
const isUnique = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** The row for one decision (shared by shadow and replay so both write identical shapes). */
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

/**
 * Decide and record ONE event for an account against its shadow projection.
 * Balance / subscription reads (GET only) happen only when the rule needs them and never inside the DB transaction; the
 * transaction holds a per-account advisory lock so two events for one account can't interleave their projection read and insert.
 */
export async function applyDunning(db: Db, input: ApplyInput, opts: { mode?: Mode; deps?: ApplyDeps } = {}): Promise<ApplyResult> {
  const mode = opts.mode ?? dunningMode();
  if (mode === "live") throw new Error("live dunning is not implemented in this release (7b)");
  const deps = opts.deps ?? {};
  const now = (deps.now ?? (() => new Date()))();

  const dupWhere = { trigger_ghlAccountId_mode: { trigger: input.trigger, ghlAccountId: input.ghlAccountId, mode } };
  if (await db.dunningDecision.findUnique({ where: dupWhere, select: { id: true } })) return { status: "duplicate" };

  const account = await db.ghlAccount.findUnique({ where: { id: input.ghlAccountId }, select: { accountType: true, locationId: true, coreCoveredUntil: true } });
  if (!account) return { status: "skipped", why: "account not found" };
  if (account.accountType !== "member") return { status: "skipped", why: "not a member account" };

  if (mode === "shadow" && now.getTime() - input.eventAt.getTime() > (deps.maxAgeMs ?? SHADOW_MAX_AGE_MS)) {
    return { status: "skipped", why: "historical event (older than 48h): covered by replay, not the live shadow" };
  }

  const projMode = mode === "replay" ? "replay" : "shadow"; // each mode projects from its own decisions; replay never feeds shadow
  const initial = await loadProjection(db, input.ghlAccountId, projMode);
  if (!initial) return { status: "skipped", why: "account not found" };
  const proj: Projection = initial;
  if (mode === "shadow" && proj.lastEventAt && input.eventAt.getTime() < proj.lastEventAt.getTime()) {
    return { status: "skipped", why: "out of order: a later event is already projected" };
  }

  // External reads — only what this event needs, and outside the transaction.
  let balance: BalanceReading | undefined;
  if (needsBalance(proj, input.event)) balance = await (deps.readBalance ?? readBalance)(account.locationId);
  let subscription: SubscriptionInfo | null | undefined;
  if (needsSubscription(proj, input.event)) {
    try {
      subscription = input.subscriptionId ? await (deps.readSubscription ?? fetchSubscription)(input.subscriptionId) : null;
    } catch {
      subscription = null;
    }
  }

  try {
    return await db.$transaction(async (tx) => {
      // Serialize per account (SELECT 1 FROM (…) so Prisma never has to deserialize the void return of pg_advisory_xact_lock).
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${input.ghlAccountId}))) AS t`;
      if (await tx.dunningDecision.findUnique({ where: dupWhere, select: { id: true } })) return { status: "duplicate" as const };
      const cur: Projection = (await loadProjection(tx as unknown as PrismaClient, input.ghlAccountId, projMode)) ?? proj;
      // The projection may have moved while we were reading; a read we didn't make degrades to "unknown", never to a guess.
      let reading = balance;
      if (needsBalance(cur, input.event) && !reading) reading = { status: "unknown", why: "state changed while processing" };
      const ctx: Context = { now: mode === "replay" ? input.eventAt : now, coveredUntil: account.coreCoveredUntil, walletBalance: reading, subscription };
      const decision = decide(cur, input.event, ctx);
      await tx.dunningDecision.create({ data: decisionRow({ ghlAccountId: input.ghlAccountId, trigger: input.trigger, eventAt: input.eventAt, event: input.event, from: cur, decision, mode, balance: reading }) });
      return { status: "recorded" as const, decision, balance: reading };
    });
  } catch (e) {
    if (isUnique(e)) return { status: "duplicate" };
    throw e;
  }
}

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

/** Record a shadow failure where the admin Health page can see it (JobRun "dunning_shadow"; not one of the scheduled jobs). */
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
 * DUNNING_MODE) is caught, logged and recorded; the webhook's 200 and the ledger write are untouched.
 */
export async function shadowDunningForLedger(db: PrismaClient, ghlTransactionId: string, opts: { deps?: ApplyDeps } = {}): Promise<ApplyResult | null> {
  try {
    dunningMode();
    return await applyFromLedger(db, ghlTransactionId, { mode: "shadow", deps: opts.deps });
  } catch (err) {
    console.error("[dunning-shadow] failed for", ghlTransactionId, err instanceof Error ? err.message : err);
    await recordShadowError(db, err, `ledger:${ghlTransactionId}`);
    return null;
  }
}
