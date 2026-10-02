import { describe, expect, it } from "vitest";
import { classifyOnboardingProgress, PROVISIONED_FLOOR, type AccountRow } from "../onboardingProgressBackfill";

const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: "A1",
  userId: "U1",
  onboardingStage: null,
  onboardingProgress: null,
  locationId: null,
  ...over,
});

describe("classifyOnboardingProgress", () => {
  it("a recognized progress stage not yet set is reported as wouldSet", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "Onboarding Form Confirmed" }));
    expect(r.wouldSet).toEqual([{ id: "A1", stage: "Onboarding Form Confirmed" }]);
    expect(r.alreadySet).toEqual([]);
    expect(r.provisionedFloor).toEqual([]);
    expect(r.unmapped).toEqual([]);
  });

  it("a recognized progress stage already matching onboardingProgress is alreadySet (idempotent)", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "A2P Pending", onboardingProgress: "A2P Pending" }));
    expect(r.alreadySet).toEqual(["A1"]);
    expect(r.wouldSet).toEqual([]);
  });

  it("side stages never touch progress, regardless of locationId", () => {
    for (const stage of ["Blocker Detected", "Payment Failed", "Paused"]) {
      const r = classifyOnboardingProgress(row({ onboardingStage: stage, locationId: "LOC1" }));
      expect(r.sideStageSkipped).toEqual(["A1"]);
      expect(r.wouldSet).toEqual([]);
      expect(r.provisionedFloor).toEqual([]);
      expect(r.unmapped).toEqual([]);
    }
  });

  it("an unmapped stage with a locationId is floored at 'Sub Account Provisioned', reported separately from unmapped", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "Active Member", locationId: "LOC1" }));
    expect(r.provisionedFloor).toEqual([{ id: "A1", userId: "U1", onboardingStage: "Active Member" }]);
    expect(r.unmapped).toEqual([]);
    expect(r.wouldSet).toEqual([]);
    expect(PROVISIONED_FLOOR).toBe("Sub Account Provisioned");
  });

  it("an unmapped stage with no locationId stays fully unmapped — never guessed", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "Some Renamed Stage", locationId: null }));
    expect(r.unmapped).toEqual([{ id: "A1", userId: "U1", onboardingStage: "Some Renamed Stage" }]);
    expect(r.provisionedFloor).toEqual([]);
  });

  it("the floor never regresses or re-applies once onboardingProgress is already at/past Sub Account Provisioned", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "Active Member", onboardingProgress: "A2P Approved", locationId: "LOC1" }));
    expect(r.provisionedFloor).toEqual([]);
    expect(r.alreadySet).toEqual(["A1"]);
  });

  it("the floor does not fire for an account already exactly at the floor stage", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "Active Member", onboardingProgress: "Sub Account Provisioned", locationId: "LOC1" }));
    expect(r.provisionedFloor).toEqual([]);
    expect(r.alreadySet).toEqual(["A1"]);
  });

  it("the floor still applies when onboardingProgress is set but earlier than the floor rank", () => {
    const r = classifyOnboardingProgress(row({ onboardingStage: "Active Member", onboardingProgress: "New Client", locationId: "LOC1" }));
    expect(r.provisionedFloor).toEqual([{ id: "A1", userId: "U1", onboardingStage: "Active Member" }]);
  });
});
