import { describe, expect, it } from "vitest";
import { isOnboardingStageKey, ONBOARDING_STAGE_KEYS } from "../onboardingStages";

describe("onboarding stage keys", () => {
  it("has exactly the nine keys, in order", () => {
    expect(ONBOARDING_STAGE_KEYS).toEqual([
      "new_client",
      "onboarding_form_submitted",
      "onboarding_form_confirmed",
      "sub_account_provisioned",
      "awaiting_kyc",
      "kyc_complete",
      "a2p_pending",
      "a2p_approved",
      "blocker_detected",
    ]);
  });
  it("isOnboardingStageKey accepts every key and rejects anything else", () => {
    for (const k of ONBOARDING_STAGE_KEYS) expect(isOnboardingStageKey(k)).toBe(true);
    expect(isOnboardingStageKey("active")).toBe(false); // an active_client BillingState key, not an onboarding one
    expect(isOnboardingStageKey("A2P_APPROVED")).toBe(false); // exact match only
    expect(isOnboardingStageKey(null)).toBe(false);
  });
});
