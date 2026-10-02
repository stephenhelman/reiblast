import type { SubRow } from "../subscriptions";
import type { DunningEvent } from "./types";

/** Days after trialEndsAt before an unconverted trial counts as a failed conversion. */
export const TRIAL_GRACE_DAYS = 2;
/** Subscription statuses that end the relationship (trial-expiry never applies to these). */
export const ENDED_STATUSES = ["canceled", "expired", "incomplete_expired"] as const;

export type SweepEvent = { suffix: "canceled" | "expired" | "trialing"; event: DunningEvent };

/**
 * What a subscription's STATUS CHANGE means for the engine. `prev` = the last-seen status (null = never seen / first-run seed, in which
 * case the current status is treated as new). paused / unpaid / incomplete_expired / active never emit an event (unpaid is shown on Health only).
 */
export function transitionEvents(sub: Pick<SubRow, "status" | "trialEndsAt" | "cancelledAt" | "updatedAt">, prev: string | null, now: Date): SweepEvent[] {
  if (prev === sub.status) return [];
  if (sub.status === "canceled") {
    const at = sub.cancelledAt ?? sub.updatedAt ?? now;
    const duringTrial = !!sub.trialEndsAt && at.getTime() < sub.trialEndsAt.getTime();
    return [{ suffix: "canceled", event: { kind: "subscription_canceled", duringTrial } }];
  }
  if (sub.status === "expired") return [{ suffix: "expired", event: { kind: "subscription_expired" } }];
  if (sub.status === "trialing") return [{ suffix: "trialing", event: { kind: "subscription_trialing" } }];
  return [];
}

/**
 * The trigger for a churn event. While covered (now < coreCoveredUntil) a non-trial churn is DEFERRED: it is recorded under a trigger that
 * includes the coverage date, so it is written once per coverage value and the real churn (the plain trigger) can still fire once
 * coverage ends. A cancel during the trial is never deferred.
 */
export function churnTrigger(subscriptionId: string, suffix: "canceled" | "expired", opts: { duringTrial: boolean; coveredUntil: Date | null; now: Date }): string {
  const base = `sub:${subscriptionId}:${suffix}`;
  if (!opts.duringTrial && opts.coveredUntil && opts.now.getTime() < opts.coveredUntil.getTime()) return `${base}:deferred:${opts.coveredUntil.toISOString().slice(0, 10)}`;
  return base;
}

/** Has a trial ended (+grace) on a subscription that is still live? (Whether it CONVERTED is a ledger question, checked by the job.) */
export function trialEndedWithoutRelationshipEnd(sub: Pick<SubRow, "status" | "trialEndsAt">, now: Date): boolean {
  if (!sub.trialEndsAt || (ENDED_STATUSES as readonly string[]).includes(sub.status)) return false;
  return now.getTime() > sub.trialEndsAt.getTime() + TRIAL_GRACE_DAYS * 864e5;
}

export const trialEndedTrigger = (subscriptionId: string): string => `sub:${subscriptionId}:trial_ended`;

/** A subscription that is (or may become) BILLING the member: trialing, active or unpaid. `paused` is billing stopped, so it does not count. */
export const LIVE_STATUSES = ["trialing", "active", "unpaid"] as const;

/**
 * A contact can hold several subscriptions (an old one canceled after a processor migration, plus a live one). A canceled or
 * expired subscription must NOT churn an account whose contact still has another live subscription.
 */
export function hasOtherLiveSubscription(all: { id: string; contactId: string; status: string }[], sub: { id: string; contactId: string }): boolean {
  return all.some((x) => x.contactId === sub.contactId && x.id !== sub.id && (LIVE_STATUSES as readonly string[]).includes(x.status));
}
