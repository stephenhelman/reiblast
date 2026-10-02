import { progressRank, type OnboardingProgressStage, type OnboardingSideStage } from "./stages";

type OnboardingStageName = OnboardingProgressStage | OnboardingSideStage;

/**
 * Onboarding pipeline stage KEYS for the "Billing intent — Onboarding" GHL workflow (docs/ghl-workflows.md): the
 * outbox's own vocabulary for that pipeline's If/Else, matched exactly (case, underscores) — not the legacy onboarding
 * stage NAMES in lib/constants.ts (ONBOARDING_STAGES), which drive the older, separate provisioning-email flow.
 */
export const ONBOARDING_STAGE_KEYS = [
  "new_client",
  "onboarding_form_submitted",
  "onboarding_form_confirmed",
  "sub_account_provisioned",
  "awaiting_kyc",
  "kyc_complete",
  "a2p_pending",
  "a2p_approved",
  "blocker_detected",
  // Billing side stages (engine intents for members still in onboarding; keys equal the BillingState values).
  "payment_failed",
  "paused",
] as const;

export type OnboardingStageKey = (typeof ONBOARDING_STAGE_KEYS)[number];

export const isOnboardingStageKey = (v: unknown): v is OnboardingStageKey =>
  typeof v === "string" && (ONBOARDING_STAGE_KEYS as readonly string[]).includes(v);

/** Intent key → the exact Onboarding-pipeline stage NAME it places the card in (lib/billing/stages.ts is the source of truth for names). */
export const ONBOARDING_KEY_TO_STAGE_NAME: Record<OnboardingStageKey, OnboardingStageName> = {
  new_client: "New Client",
  onboarding_form_submitted: "Onboarding Form Submitted",
  onboarding_form_confirmed: "Onboarding Form Confirmed",
  sub_account_provisioned: "Sub Account Provisioned",
  awaiting_kyc: "Awaiting KYC",
  kyc_complete: "KYC Complete",
  a2p_pending: "A2P Pending",
  a2p_approved: "A2P Approved",
  blocker_detected: "Blocker Detected",
  payment_failed: "Payment Failed",
  paused: "Paused",
};

/** The intent key that places a card at a PROGRESS stage (null for a side stage or an unrecognized/absent stage — never a side stage). */
export function keyForProgressStage(stageName: string | null): OnboardingStageKey | null {
  if (!stageName || progressRank(stageName) === null) return null;
  return ONBOARDING_STAGE_KEYS.find((k) => ONBOARDING_KEY_TO_STAGE_NAME[k] === stageName) ?? null;
}
