/**
 * Backfill GhlAccount.onboardingProgress / onboardingProgressAt from the existing GhlAccount.onboardingStage values
 * (display field GHL already writes via stage-changed/legacy routes).
 *
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/backfill-onboarding-progress.ts          # dry-run
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/backfill-onboarding-progress.ts --apply   # write
 *
 * Maps onboardingStage -> the matching ONBOARDING_PROGRESS_STAGES entry via progressRank(). Side stages
 * ("Blocker Detected"/"Payment Failed"/"Paused") never set progress. An onboardingStage value that isn't a
 * recognized onboarding stage name at all (lib/billing/stages.ts ONBOARDING_STAGE_NAMES) is either:
 *   - floored at "Sub Account Provisioned" if the account has a locationId (a factual signal it was provisioned —
 *     see lib/billing/onboardingProgressBackfill.ts for the exact floor rule), reported separately, or
 *   - left fully unmapped and recorded as a GhlEvent (source "onboarding_progress_backfill_unmapped") for
 *     investigation, never guessed, if there's no locationId.
 *
 * Classification logic lives in lib/billing/onboardingProgressBackfill.ts (pure, unit-tested); this file is only
 * the DB-facing orchestration.
 */
import { connect } from "./_cli";
import { classifyOnboardingProgress, PROVISIONED_FLOOR, type AccountRow } from "../../lib/billing/onboardingProgressBackfill";

const { db: prisma, apply } = await connect();

async function main() {
  const accounts = await prisma.ghlAccount.findMany({
    where: { accountType: "member", onboardingStage: { not: null } },
    select: { id: true, userId: true, onboardingStage: true, onboardingProgress: true, locationId: true },
  });

  let wouldSet = 0;
  let alreadySet = 0;
  let sideStageSkipped = 0;
  const provisionedFloor: { id: string; userId: string; onboardingStage: string }[] = [];
  const unmapped: { id: string; userId: string; onboardingStage: string }[] = [];

  for (const a of accounts as AccountRow[]) {
    const r = classifyOnboardingProgress(a);
    wouldSet += r.wouldSet.length;
    alreadySet += r.alreadySet.length;
    sideStageSkipped += r.sideStageSkipped.length;
    provisionedFloor.push(...r.provisionedFloor);
    unmapped.push(...r.unmapped);

    if (apply) {
      for (const w of r.wouldSet) {
        await prisma.ghlAccount.update({ where: { id: w.id }, data: { onboardingProgress: w.stage, onboardingProgressAt: new Date() } });
      }
      for (const f of r.provisionedFloor) {
        await prisma.ghlAccount.update({ where: { id: f.id }, data: { onboardingProgress: PROVISIONED_FLOOR, onboardingProgressAt: new Date() } });
      }
    }
  }

  if (unmapped.length > 0 && apply) {
    await prisma.ghlEvent.createMany({
      data: unmapped.map((u) => ({
        source: "onboarding_progress_backfill_unmapped",
        externalId: u.id,
        payload: u as unknown as object,
      })),
    });
  }

  console.log(`Accounts scanned (member, onboardingStage set): ${accounts.length}`);
  console.log(`${apply ? "Set" : "Would set"} onboardingProgress: ${wouldSet}`);
  console.log(`Already correct: ${alreadySet}`);
  console.log(`Side stages (never touch progress): ${sideStageSkipped}`);
  console.log(`Floor: provisioned (unmapped stage, but locationId present => floored at "${PROVISIONED_FLOOR}"): ${provisionedFloor.length}`);
  for (const f of provisionedFloor) console.log(`  ghlAccount=${f.id} userId=${f.userId} onboardingStage=${JSON.stringify(f.onboardingStage)}`);
  console.log(`Unmapped (unrecognized onboardingStage value, no locationId — not guessed): ${unmapped.length}`);
  for (const u of unmapped) console.log(`  ghlAccount=${u.id} userId=${u.userId} onboardingStage=${JSON.stringify(u.onboardingStage)}`);
}

main().finally(() => prisma.$disconnect());
