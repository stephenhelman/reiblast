import { BillingState, PauseReason } from "@prisma/client";
import { denverDayOf, denverDayStart } from "./reports/denver";

/**
 * Trailing-N-Denver-day activity window start (default 30). Used by scripts/billing/seed-billing-state.ts to classify a
 * legacy paused/expired/canceled/incomplete_expired subscription: did the location have ANY wallet activity in this
 * window? Snapped to a Denver-day boundary (like coreCoveredUntil elsewhere), so the window is deterministic regardless
 * of the time of day the script runs.
 */
export function trailingActivityWindowStart(now: Date, days = 30): Date {
  return denverDayStart(denverDayOf(new Date(now.getTime() - days * 86_400_000)));
}

export type LegacyOutcome = { billingState: BillingState; pauseReason: PauseReason | null; legacyUnreconciled: boolean; label: string };

/**
 * `activity`: true = wallet activity in the trailing window, false = none, null = unknown (no wallet data for this
 * location at all — the caller may fall back to --wallet-dir; with no fallback either, the account is left unseeded
 * and listed, never guessed).
 */
export function classifyLegacySubscription(activity: boolean | null): LegacyOutcome | null {
  if (activity === null) return null;
  return activity
    ? { billingState: BillingState.paused, pauseReason: PauseReason.non_payment, legacyUnreconciled: true, label: "paused/non_payment (recent activity)" }
    : { billingState: BillingState.churned, pauseReason: null, legacyUnreconciled: true, label: "churned (no recent activity)" };
}
