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
] as const;

export type OnboardingStageKey = (typeof ONBOARDING_STAGE_KEYS)[number];

export const isOnboardingStageKey = (v: unknown): v is OnboardingStageKey =>
  typeof v === "string" && (ONBOARDING_STAGE_KEYS as readonly string[]).includes(v);
