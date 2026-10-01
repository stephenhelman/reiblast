import { describe, expect, it } from "vitest";
import {
  CLIENTS_STAGES,
  ONBOARDING_PROGRESS_STAGES,
  ONBOARDING_SIDE_STAGES,
  isForwardProgress,
  isKnownOnboardingStage,
  isOnboardingSideStage,
  progressRank,
  stageIdentity,
} from "../stages";

describe("progressRank", () => {
  it("returns the index for each progress stage, in order", () => {
    ONBOARDING_PROGRESS_STAGES.forEach((s, i) => expect(progressRank(s)).toBe(i));
  });
  it("returns null for side stages and unrecognized names", () => {
    for (const s of ONBOARDING_SIDE_STAGES) expect(progressRank(s)).toBeNull();
    expect(progressRank("Not A Real Stage")).toBeNull();
  });
});

describe("isForwardProgress", () => {
  it("null current -> any real progress stage is forward", () => {
    expect(isForwardProgress(null, "New Client")).toBe(true);
    expect(isForwardProgress(null, "A2P Approved")).toBe(true);
  });
  it("a later stage is forward, an earlier or equal one is not", () => {
    expect(isForwardProgress("Onboarding Form Submitted", "Onboarding Form Confirmed")).toBe(true);
    expect(isForwardProgress("Onboarding Form Confirmed", "Onboarding Form Submitted")).toBe(false);
    expect(isForwardProgress("Onboarding Form Confirmed", "Onboarding Form Confirmed")).toBe(false);
  });
  it("side stages never count as forward progress, regardless of current value", () => {
    for (const s of ONBOARDING_SIDE_STAGES) {
      expect(isForwardProgress(null, s)).toBe(false);
      expect(isForwardProgress("New Client", s)).toBe(false);
    }
  });
  it("an unrecognized candidate is never forward progress", () => {
    expect(isForwardProgress("New Client", "Some Unknown Stage")).toBe(false);
  });
});

describe("stage identity", () => {
  it("Payment Failed and Paused are distinct identities across the two pipelines", () => {
    expect(stageIdentity("onboarding", "Payment Failed")).not.toBe(stageIdentity("active_client", "Payment Failed"));
    expect(stageIdentity("onboarding", "Paused")).not.toBe(stageIdentity("active_client", "Paused"));
  });
});

describe("known-stage helpers", () => {
  it("isKnownOnboardingStage accepts progress and side stages, rejects anything else", () => {
    for (const s of ONBOARDING_PROGRESS_STAGES) expect(isKnownOnboardingStage(s)).toBe(true);
    for (const s of ONBOARDING_SIDE_STAGES) expect(isKnownOnboardingStage(s)).toBe(true);
    expect(isKnownOnboardingStage("Active Member")).toBe(false); // that's a Clients-pipeline stage, not onboarding
  });
  it("isOnboardingSideStage is true only for the three side stages", () => {
    for (const s of ONBOARDING_SIDE_STAGES) expect(isOnboardingSideStage(s)).toBe(true);
    for (const s of ONBOARDING_PROGRESS_STAGES) expect(isOnboardingSideStage(s)).toBe(false);
  });
  it("Clients pipeline stage list is exactly as specified", () => {
    expect(CLIENTS_STAGES).toEqual(["Trial", "Active Member", "Payment Failed", "Paused", "Inactive", "Churned"]);
  });
});
