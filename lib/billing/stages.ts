/**
 * Stage identity for the two GHL pipelines that drive onboarding/dunning, used by the default GHL "stage changed"
 * webhook (lib/billing/events/stageChanged.ts) — NOT the same vocabulary as the outbox's intent-kind keys
 * (lib/billing/onboardingStages.ts, snake_case, used only by the "Billing intent — Onboarding" workflow's If/Else),
 * and NOT the same vocabulary as the legacy single-pipeline lib/constants.ts ONBOARDING_STAGES (older provisioning-email
 * flow, left untouched). These are the exact opportunity stage NAMES as they must be configured in GHL.
 *
 * Pipeline identifiers match the existing ones in lib/billing/intents/send.ts / lib/billing/events/stageChanged.ts:
 * "onboarding" and "active_client" (the latter is referred to as the "Clients pipeline" in product docs/specs, but the
 * code-level identifier stays "active_client" so there is only one name for it).
 */

import type { BillingState } from "@prisma/client";

export const PIPELINES = ["onboarding", "active_client"] as const;
export type Pipeline = (typeof PIPELINES)[number];

/** Onboarding pipeline: forward-only progress stages, in order. Index = progress rank. */
export const ONBOARDING_PROGRESS_STAGES = [
  "New Client",
  "Onboarding Form Submitted",
  "Onboarding Form Confirmed",
  "Sub Account Provisioned",
  "Awaiting KYC",
  "KYC Complete",
  "A2P Pending",
  "A2P Approved",
] as const;
export type OnboardingProgressStage = (typeof ONBOARDING_PROGRESS_STAGES)[number];

/** Onboarding pipeline: side stages that a card can sit in without it meaning progress moved forward or backward. */
export const ONBOARDING_SIDE_STAGES = ["Blocker Detected", "Payment Failed", "Paused"] as const;
export type OnboardingSideStage = (typeof ONBOARDING_SIDE_STAGES)[number];

export const ONBOARDING_STAGE_NAMES: readonly string[] = [...ONBOARDING_PROGRESS_STAGES, ...ONBOARDING_SIDE_STAGES];

/** Clients ("active_client") pipeline stage names. */
export const CLIENTS_STAGES = ["Trial", "Active Member", "Payment Failed", "Paused", "Inactive", "Churned"] as const;
export type ClientsStage = (typeof CLIENTS_STAGES)[number];

/** Clients stage NAME → BillingState key (docs/ghl-server-contract.md: stage keys equal BillingState values). Exact-name matching only. */
export const CLIENTS_STAGE_NAME_TO_STATE: Record<ClientsStage, BillingState> = {
  Trial: "trial",
  "Active Member": "active",
  "Payment Failed": "payment_failed",
  Paused: "paused",
  Inactive: "inactive",
  Churned: "churned",
};

/** The BillingState a Clients stage NAME or lowercase key means (exact match, case and spacing included), or null. Never guesses. */
export function billingStateForClientsStage(stage: string): BillingState | null {
  if (Object.prototype.hasOwnProperty.call(CLIENTS_STAGE_NAME_TO_STATE, stage)) return CLIENTS_STAGE_NAME_TO_STATE[stage as ClientsStage];
  return (Object.values(CLIENTS_STAGE_NAME_TO_STATE) as string[]).includes(stage) ? (stage as BillingState) : null;
}

/**
 * Stage identity = (pipeline, stageKey). "Payment Failed" and "Paused" exist as distinct identities in both
 * pipelines — this string key is how call sites must compare/store them so the two are never conflated.
 */
export function stageIdentity(pipeline: Pipeline, stageKey: string): string {
  return `${pipeline}::${stageKey}`;
}

/** Onboarding progress rank (0-based) for a stage name, or null if it's a side stage / not a recognized onboarding stage at all. */
export function progressRank(stageKey: string): number | null {
  const idx = (ONBOARDING_PROGRESS_STAGES as readonly string[]).indexOf(stageKey);
  return idx === -1 ? null : idx;
}

export function isOnboardingSideStage(stageKey: string): boolean {
  return (ONBOARDING_SIDE_STAGES as readonly string[]).includes(stageKey);
}

export function isKnownOnboardingStage(stageKey: string): boolean {
  return (ONBOARDING_STAGE_NAMES as readonly string[]).includes(stageKey);
}

/**
 * Is `candidate` forward progress relative to `current` (the stored onboardingProgress stage name, or null for
 * "no progress recorded yet")? Side stages and unrecognized stage names are never forward progress.
 */
export function isForwardProgress(current: string | null, candidate: string): boolean {
  const candidateRank = progressRank(candidate);
  if (candidateRank === null) return false;
  if (current === null) return true;
  const currentRank = progressRank(current);
  if (currentRank === null) return true; // stored value isn't a progress stage (shouldn't happen) — treat any real progress stage as forward
  return candidateRank > currentRank;
}
