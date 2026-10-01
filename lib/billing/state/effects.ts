import { Prisma, type PrismaClient } from "@prisma/client";
import type { ApplyDeps } from "./apply";
import type { SideEffect } from "./types";

/**
 * Live-mode side effects (saas_pause / saas_resume) and their retry (docs/cutover.md §5 "resolved decisions"). The first
 * attempt happens synchronously right after a live decision commits (executeEffects, called from applyDunning). A failed
 * attempt is retried with backoff — by the replay job every run, and opportunistically after each processed payment event
 * — up to MAX_EFFECT_ATTEMPTS total, each attempt recorded on the DunningDecision row it belongs to.
 *
 * Idempotent: a retry never fires an effect whose decision has been superseded by a later live decision for the same
 * account — it marks the stale effect `superseded` instead (never retried, never alerted) rather than risk undoing
 * a later, already-executed decision.
 */
export const MAX_EFFECT_ATTEMPTS = 5;
export const EFFECT_BACKOFF_MS = [5, 30, 120, 360, 1440].map((min) => min * 60_000); // 5m, 30m, 2h, 6h, 24h

export type SideEffectResult = SideEffect & {
  executedAt?: string;
  error?: string;
  attempts?: number;
  nextRetryAt?: string;
  /** A later live decision for the account exists; this effect is stale and is never retried or alerted on again. */
  superseded?: boolean;
  /** attempts reached MAX_EFFECT_ATTEMPTS with no success. */
  exhausted?: boolean;
};

export const backoffMs = (attempts: number): number => EFFECT_BACKOFF_MS[Math.min(attempts, EFFECT_BACKOFF_MS.length) - 1];

/** Whether this effect is due for (re)try right now: failed, not superseded/exhausted, under the attempt cap, and past its backoff. */
export function dueForRetry(e: SideEffectResult, now: Date): boolean {
  if (e.executedAt || e.superseded || e.exhausted) return false;
  if (!e.error) return false; // never attempted at all is handled by executeEffects right after commit, not here
  if ((e.attempts ?? 0) >= MAX_EFFECT_ATTEMPTS) return false;
  return !e.nextRetryAt || new Date(e.nextRetryAt) <= now;
}

async function runOneEffect(e: SideEffect, locationId: string | null, deps: ApplyDeps): Promise<{ executedAt: string } | { error: string }> {
  try {
    if (!locationId) throw new Error("account has no locationId");
    if (e.type === "saas_pause") await (deps.pause ?? (await import("@/lib/ghl/client")).pauseLocation)(locationId);
    else await (deps.unpause ?? (await import("@/lib/ghl/client")).unpauseLocation)(locationId);
    return { executedAt: new Date().toISOString() };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

/** The FIRST attempt, called synchronously right after a live decision's transaction commits (from applyDunning). */
export async function executeEffects(effects: SideEffect[], locationId: string | null, deps: ApplyDeps): Promise<SideEffectResult[]> {
  const out: SideEffectResult[] = [];
  for (const e of effects) {
    const r = await runOneEffect(e, locationId, deps);
    out.push("executedAt" in r ? { ...e, executedAt: r.executedAt } : { ...e, error: r.error, attempts: 1, nextRetryAt: new Date(Date.now() + backoffMs(1)).toISOString() });
  }
  return out;
}

export type RetryStats = { attempted: number; succeeded: number; stillFailing: number; exhausted: number; superseded: number };
const emptyStats = (): RetryStats => ({ attempted: 0, succeeded: 0, stillFailing: 0, exhausted: 0, superseded: 0 });

/**
 * Retry due side effects on live-mode decisions. Bounded: scans up to `poolSize` most recent live decisions, retries up
 * to `limit` decisions that have at least one due effect (mirrors sendPendingIntents' shape/limits). One extra query per
 * candidate decision confirms it is still the account's latest live decision before touching GHL.
 */
export async function retrySideEffects(
  db: Pick<PrismaClient, "dunningDecision" | "ghlAccount">,
  opts: { now?: () => Date; deps?: ApplyDeps; limit?: number; poolSize?: number } = {},
): Promise<RetryStats> {
  const now = (opts.now ?? (() => new Date()))();
  const deps = opts.deps ?? {};
  const stats = emptyStats();

  const pool = await db.dunningDecision.findMany({
    where: { mode: "live" },
    orderBy: [{ createdAt: "desc" }],
    take: opts.poolSize ?? 300,
    select: { id: true, ghlAccountId: true, sideEffects: true },
  });
  const due = pool.filter((d) => (d.sideEffects as SideEffectResult[]).some((e) => dueForRetry(e, now))).slice(0, opts.limit ?? 20);

  for (const d of due) {
    const latest = await db.dunningDecision.findFirst({ where: { ghlAccountId: d.ghlAccountId, mode: "live" }, orderBy: [{ eventAt: "desc" }, { createdAt: "desc" }], select: { id: true } });
    const effects = d.sideEffects as SideEffectResult[];

    if (latest?.id !== d.id) {
      // Superseded: a later live decision exists for this account — never retry or alert on this one's effects again.
      const next = effects.map((e) => (dueForRetry(e, now) ? { ...e, superseded: true } : e));
      await db.dunningDecision.update({ where: { id: d.id }, data: { sideEffects: next as unknown as Prisma.InputJsonValue } });
      stats.superseded += effects.filter((e) => dueForRetry(e, now)).length;
      continue;
    }

    const account = await db.ghlAccount.findUnique({ where: { id: d.ghlAccountId }, select: { locationId: true } });
    const next: SideEffectResult[] = [];
    for (const e of effects) {
      if (!dueForRetry(e, now)) {
        next.push(e);
        continue;
      }
      stats.attempted++;
      const r = await runOneEffect(e, account?.locationId ?? null, deps);
      if ("executedAt" in r) {
        next.push({ ...e, executedAt: r.executedAt, error: undefined, nextRetryAt: undefined });
        stats.succeeded++;
      } else {
        const attempts = (e.attempts ?? 1) + 1;
        if (attempts >= MAX_EFFECT_ATTEMPTS) {
          next.push({ ...e, attempts, error: r.error, nextRetryAt: undefined, exhausted: true });
          stats.exhausted++;
        } else {
          next.push({ ...e, attempts, error: r.error, nextRetryAt: new Date(now.getTime() + backoffMs(attempts)).toISOString() });
          stats.stillFailing++;
        }
      }
    }
    await db.dunningDecision.update({ where: { id: d.id }, data: { sideEffects: next as unknown as Prisma.InputJsonValue } });
  }

  return stats;
}

export type FailedEffectRow = {
  decisionId: string;
  ghlAccountId: string;
  type: SideEffect["type"];
  attempts: number;
  lastError: string;
  exhausted: boolean;
  nextRetryAt: string | null;
  createdAt: Date;
  /** saas_resume exhausted = alert (a member stays paused after paying); saas_pause exhausted = warning. Not exhausted = "retrying". */
  severity: "alert" | "warning" | "retrying";
};

/** Health: every live-decision effect that has ever failed and is not superseded, newest first (bounded like retrySideEffects). */
export async function getFailedSideEffects(db: Pick<PrismaClient, "dunningDecision">, poolSize = 300): Promise<FailedEffectRow[]> {
  const pool = await db.dunningDecision.findMany({
    where: { mode: "live" },
    orderBy: [{ createdAt: "desc" }],
    take: poolSize,
    select: { id: true, ghlAccountId: true, sideEffects: true, createdAt: true },
  });
  const out: FailedEffectRow[] = [];
  for (const d of pool) {
    for (const e of d.sideEffects as SideEffectResult[]) {
      if (!e.error || e.executedAt || e.superseded) continue;
      out.push({
        decisionId: d.id,
        ghlAccountId: d.ghlAccountId,
        type: e.type,
        attempts: e.attempts ?? 1,
        lastError: e.error,
        exhausted: !!e.exhausted,
        nextRetryAt: e.nextRetryAt ?? null,
        createdAt: d.createdAt,
        severity: !e.exhausted ? "retrying" : e.type === "saas_resume" ? "alert" : "warning",
      });
    }
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
