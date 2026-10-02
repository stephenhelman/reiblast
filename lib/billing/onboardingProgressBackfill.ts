import { isKnownOnboardingStage, isOnboardingSideStage, ONBOARDING_PROGRESS_STAGES, progressRank } from "./stages";

/** The floor scripts/billing/backfill-onboarding-progress.ts is willing to infer from a factual signal: a
 *  locationId exists => the sub-account was provisioned, even if onboardingStage itself is an unmapped/legacy value. */
export const PROVISIONED_FLOOR = "Sub Account Provisioned" as const satisfies (typeof ONBOARDING_PROGRESS_STAGES)[number];

export type AccountRow = { id: string; userId: string; onboardingStage: string | null; onboardingProgress: string | null; locationId: string | null };

export type BackfillResult = {
  wouldSet: { id: string; stage: string }[];
  alreadySet: string[];
  sideStageSkipped: string[];
  provisionedFloor: { id: string; userId: string; onboardingStage: string }[];
  unmapped: { id: string; userId: string; onboardingStage: string }[];
};

/**
 * Pure classification for one GhlAccount row — no DB access, so it's directly testable. Mirrors the logic the
 * backfill script applies per account:
 *   - side stages never touch progress
 *   - a recognized progress stage maps directly (idempotent: already-correct rows are reported separately)
 *   - an unrecognized onboardingStage with a locationId set is floored at "Sub Account Provisioned" (a factual
 *     signal provisioning already happened), but ONLY as a floor — never applied if onboardingProgress is already
 *     at/past that rank, and never lets this rule regress or skip past a value that should map further along
 *   - an unrecognized onboardingStage with no locationId stays fully unmapped (never guessed)
 */
export function classifyOnboardingProgress(a: AccountRow): BackfillResult {
  const result: BackfillResult = { wouldSet: [], alreadySet: [], sideStageSkipped: [], provisionedFloor: [], unmapped: [] };
  const stage = a.onboardingStage as string;

  if (isOnboardingSideStage(stage)) {
    result.sideStageSkipped.push(a.id);
    return result;
  }

  const rank = isKnownOnboardingStage(stage) ? progressRank(stage) : null;
  if (rank !== null) {
    if (a.onboardingProgress === stage) result.alreadySet.push(a.id);
    else result.wouldSet.push({ id: a.id, stage });
    return result;
  }

  if (a.locationId) {
    const currentRank = a.onboardingProgress ? progressRank(a.onboardingProgress) : null;
    const floorRank = progressRank(PROVISIONED_FLOOR)!;
    if (currentRank !== null && currentRank >= floorRank) {
      result.alreadySet.push(a.id); // already at/past the floor — nothing to do
    } else {
      result.provisionedFloor.push({ id: a.id, userId: a.userId, onboardingStage: stage });
    }
    return result;
  }

  result.unmapped.push({ id: a.id, userId: a.userId, onboardingStage: stage });
  return result;
}
