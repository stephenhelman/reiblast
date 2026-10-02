import { describe, expect, it } from "vitest";
import { isOnboardingStageKey, keyForProgressStage, ONBOARDING_KEY_TO_STAGE_NAME, ONBOARDING_STAGE_KEYS } from "../onboardingStages";
import { ONBOARDING_PROGRESS_STAGES, ONBOARDING_STAGE_NAMES } from "../stages";

describe("onboarding stage keys", () => {
  it("has exactly the eleven keys, in order", () => {
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
      "payment_failed",
      "paused",
    ]);
  });
  it("isOnboardingStageKey accepts every key and rejects anything else", () => {
    for (const k of ONBOARDING_STAGE_KEYS) expect(isOnboardingStageKey(k)).toBe(true);
    expect(isOnboardingStageKey("active")).toBe(false); // an active_client BillingState key, not an onboarding one
    expect(isOnboardingStageKey("A2P_APPROVED")).toBe(false); // exact match only
    expect(isOnboardingStageKey(null)).toBe(false);
  });
});

describe("onboarding intent keys ↔ lib/billing/stages.ts names", () => {
  it("every key maps to a stage name that exists in stages.ts, one-to-one", () => {
    const names = ONBOARDING_STAGE_KEYS.map((k) => ONBOARDING_KEY_TO_STAGE_NAME[k]);
    for (const n of names) expect(ONBOARDING_STAGE_NAMES).toContain(n);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(ONBOARDING_STAGE_NAMES.length);
  });
  it("the billing side-stage keys map to \"Payment Failed\" / \"Paused\"", () => {
    expect(ONBOARDING_KEY_TO_STAGE_NAME.payment_failed).toBe("Payment Failed");
    expect(ONBOARDING_KEY_TO_STAGE_NAME.paused).toBe("Paused");
  });
  it("keyForProgressStage: every progress stage has a key; side stages, unknown and null never do", () => {
    for (const n of ONBOARDING_PROGRESS_STAGES) expect(keyForProgressStage(n)).not.toBeNull();
    expect(keyForProgressStage("A2P Approved")).toBe("a2p_approved");
    expect(keyForProgressStage("Paused")).toBeNull();
    expect(keyForProgressStage("Blocker Detected")).toBeNull();
    expect(keyForProgressStage("nonsense")).toBeNull();
    expect(keyForProgressStage(null)).toBeNull();
  });
});
