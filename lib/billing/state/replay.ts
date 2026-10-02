import type { BillingClass } from "@prisma/client";
import { decide, needsBalance, needsSubscription } from "./transition";
import type { BalanceReading, BillingState, Decision, DunningEvent, Snapshot, SubscriptionInfo } from "./types";

/**
 * Pure core of the historical replay: run one account's events, in time order, through decide() from a neutral seed.
 * No I/O — balances and subscriptions arrive as resolvers (the script pre-computes them).
 */
export type ReplayEvent = { trigger: string; event: DunningEvent; eventAt: Date; subscriptionId: string | null };
export type ReplayStep = { trigger: string; eventKind: DunningEvent["kind"]; eventAt: Date; from: Snapshot; decision: Decision; balance?: BalanceReading };

/** Neutral start: trial if the account's FIRST core-related row (core_subscription or trial_auth) is a trial_auth, else active. */
export function seedSnapshot(rows: { classification: BillingClass; occurredAt: Date }[]): Snapshot {
  const first = rows.filter((r) => r.classification === "core_subscription" || r.classification === "trial_auth").sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
  return { state: first?.classification === "trial_auth" ? "trial" : "active", strikes: 0, pauseReason: null, coreFailureOpen: false };
}

export function replayAccount(
  events: ReplayEvent[],
  opts: { seed: Snapshot; coveredUntil: Date | null; balanceFor: (e: ReplayEvent) => BalanceReading | undefined; subscriptionFor: (e: ReplayEvent) => SubscriptionInfo | null | undefined },
): { steps: ReplayStep[]; final: Snapshot & { trialOffer: string | null; trialEndsAt: Date | null } } {
  const ordered = [...events].sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime() || (a.trigger < b.trigger ? -1 : 1));
  let cur: Snapshot = opts.seed;
  let trialOffer: string | null = null;
  let trialEndsAt: Date | null = null;
  const steps: ReplayStep[] = [];
  for (const ev of ordered) {
    const balance = needsBalance(cur, ev.event) ? opts.balanceFor(ev) : undefined;
    const subscription = needsSubscription(cur, ev.event) ? opts.subscriptionFor(ev) : undefined;
    const decision = decide(cur, ev.event, { now: ev.eventAt, coveredUntil: opts.coveredUntil, walletBalance: balance, subscription });
    steps.push({ trigger: ev.trigger, eventKind: ev.event.kind, eventAt: ev.eventAt, from: cur, decision, balance });
    if (decision.trialChanged) {
      trialOffer = decision.trialOffer;
      trialEndsAt = decision.trialEndsAt;
    }
    cur = { state: decision.nextState, strikes: decision.warningCount, pauseReason: decision.pauseReason, coreFailureOpen: decision.coreFailureOpen };
  }
  return { steps, final: { ...cur, trialOffer, trialEndsAt } };
}

export type Milestone = { at: Date; kind: "strike" | "paused" | "resumed" | "payment_failed" | "recovered" | "trial" | "covered_ignored"; detail: string };

/** Human-readable timeline: strikes, pauses (with reason), resumes, payment_failed episodes (enter/leave), covered-ignored failures. */
export function milestones(steps: ReplayStep[]): Milestone[] {
  const out: Milestone[] = [];
  for (const s of steps) {
    const d = s.decision;
    const from = s.from.state;
    const to = d.nextState;
    if (s.eventKind === "wallet_recharge_failed" && d.warningCount > s.from.strikes) out.push({ at: s.eventAt, kind: "strike", detail: `strike ${d.warningCount}${s.balance?.status === "ok" && s.balance.estimated ? " (estimated balance)" : ""}` });
    if (d.reason.startsWith("covered, ignored")) out.push({ at: s.eventAt, kind: "covered_ignored", detail: d.reason });
    if (to === "paused" && from !== "paused") out.push({ at: s.eventAt, kind: "paused", detail: `paused (${d.pauseReason ?? "?"})` });
    else if (from === "paused" && to !== "paused") out.push({ at: s.eventAt, kind: "resumed", detail: `resumed → ${to}` });
    else if (to === "payment_failed" && from !== "payment_failed") out.push({ at: s.eventAt, kind: "payment_failed", detail: "payment_failed begins" });
    else if (from === "payment_failed" && to !== "payment_failed") out.push({ at: s.eventAt, kind: "recovered", detail: `payment_failed ends → ${to}` });
    if (to === "trial" && from !== "trial") out.push({ at: s.eventAt, kind: "trial", detail: `trial${d.trialOffer ? ` (${d.trialOffer})` : ""}` });
  }
  return out;
}

export const isParked = (s: BillingState | null): boolean => s === "paused" || s === "inactive" || s === "churned";
