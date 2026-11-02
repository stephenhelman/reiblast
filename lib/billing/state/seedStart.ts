import type { PrismaClient } from "@prisma/client";
import { TRIAL_OFFER_RE, type BillingState, type DunningEvent, type PauseReason } from "./types";

/**
 * STARTING-STATE SEEDING. A member whose GhlAccount.billingState is null can't be placed by the Clients handoff, and in shadow mode the
 * engine never writes the account — so a new member would stay null forever. This is the one write shadow mode is allowed: it fills a
 * NULL state with the member's starting state (trial / active / payment_failed) and nothing else. No side effects, no intents, strikes
 * untouched, and a non-null state is never overwritten (the update is conditional on billingState IS NULL).
 */
export const SEEDABLE_STATES: BillingState[] = ["trial", "active", "payment_failed"];

/** Events that establish a member's starting state (first trial / core payment / subscription status). Wallet events never seed. */
export const SEEDING_EVENTS: DunningEvent["kind"][] = ["trial_auth_succeeded", "subscription_trialing", "core_succeeded", "subscription_expired"];

export type StartingState = { billingState: BillingState; pauseReason: PauseReason | null; trialOffer?: string | null; trialEndsAt?: Date | null };

/** Write the starting state iff the account's billingState is still null. Returns true when it wrote. */
export async function seedStartingState(db: Pick<PrismaClient, "ghlAccount">, ghlAccountId: string, s: StartingState): Promise<boolean> {
  if (!SEEDABLE_STATES.includes(s.billingState)) return false;
  const r = await db.ghlAccount.updateMany({
    where: { id: ghlAccountId, accountType: "member", billingState: null },
    data: { billingState: s.billingState, pauseReason: s.pauseReason, ...(s.trialOffer !== undefined || s.trialEndsAt !== undefined ? { trialOffer: s.trialOffer ?? null, trialEndsAt: s.trialEndsAt ?? null } : {}) },
  });
  return r.count > 0;
}

/**
 * The starting state a member's subscription status implies, when no engine event fired: trialing → trial (offer from the name,
 * end date), active → active, unpaid → payment_failed. Everything else (paused, canceled, expired, incomplete_expired, …) is left
 * unseeded: those are departures or legacy states for the seed script / the event rules, never guessed here.
 */
export function startingStateForSubscription(sub: { status: string; name: string | null; trialEndsAt: Date | null }): StartingState | null {
  if (sub.status === "trialing") return { billingState: "trial", pauseReason: null, trialOffer: sub.name && TRIAL_OFFER_RE.test(sub.name) ? sub.name : null, trialEndsAt: sub.trialEndsAt };
  if (sub.status === "active") return { billingState: "active", pauseReason: null };
  if (sub.status === "unpaid") return { billingState: "payment_failed", pauseReason: null };
  return null;
}

/** Liveness rank when a contact holds several subscriptions: the best one decides the starting state. */
const RANK: Record<string, number> = { active: 0, trialing: 1, unpaid: 2 };
export const bestSubscription = <T extends { status: string }>(subs: T[]): T | null =>
  subs.filter((s) => s.status in RANK).sort((a, b) => RANK[a.status] - RANK[b.status])[0] ?? null;
