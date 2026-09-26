/**
 * Backfill GhlAccount rows from User GHL identity fields.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/backfill-ghl-accounts.ts          # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/billing/backfill-ghl-accounts.ts --apply  # write
 *
 * DATABASE_URL must point at a non-production database.
 * billingState is only set for suspended (paused/non_payment) and inactive users;
 * everyone else stays null ("not yet seeded") until seed-billing-state.ts runs.
 * Never copies ghlUserId, ghlLocationApiKey, or OTP fields.
 */
import { PrismaClient, BillingState, PauseReason } from "@prisma/client";

const PROD_HOST = "ep-restless-silence";
const apply = process.argv.includes("--apply");

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL is not set.");
if (url.includes(PROD_HOST)) throw new Error("Refusing to run against the production host.");
const host = new URL(url).host;
console.log(`Host: ${host}`);
console.log(`Mode: ${apply ? "APPLY (writing)" : "dry-run"}\n`);

const prisma = new PrismaClient({ datasources: { db: { url } } });

function maskEmail(email: string | null): string {
  if (!email) return "(no email)";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
  // Pre-check: duplicates and location-without-contact.
  const withContact = await prisma.user.findMany({
    where: { ghlContactId: { not: null } },
    select: { id: true, email: true, ghlContactId: true },
  });
  const byContact = new Map<string, string[]>();
  for (const u of withContact) {
    const k = u.ghlContactId as string;
    byContact.set(k, [...(byContact.get(k) ?? []), u.id]);
  }
  const dupes = [...byContact.entries()].filter(([, ids]) => ids.length > 1);
  const orphanLocation = await prisma.user.findMany({
    where: { ghlLocationId: { not: null }, ghlContactId: null },
    select: { id: true, email: true },
  });

  console.log(`Users with ghlContactId: ${withContact.length}`);
  console.log(`Duplicate ghlContactId values: ${dupes.length}`);
  for (const [cid, ids] of dupes) console.log(`  ${cid}: users ${ids.join(", ")}`);
  console.log(`Users with ghlLocationId but no ghlContactId: ${orphanLocation.length}`);
  for (const u of orphanLocation) console.log(`  ${u.id} ${maskEmail(u.email)}`);

  if (dupes.length > 0) {
    console.log("\nDuplicates found — stopping without writing.");
    process.exitCode = 1;
    return;
  }

  const users = await prisma.user.findMany({
    where: { ghlContactId: { not: null } },
    select: {
      id: true,
      email: true,
      status: true,
      ghlContactId: true,
      ghlLocationId: true,
      warningCount: true,
      onboardingStage: true,
      ghlLocationToken: true,
      ghlLocationTokenExpiresAt: true,
    },
  });
  const existing = new Set(
    (await prisma.ghlAccount.findMany({ select: { userId: true } })).map((a) => a.userId),
  );

  let created = 0;
  let updated = 0;
  const skipped = 0;
  let seededCount = 0;
  const unseeded: string[] = [];

  for (const u of users) {
    let seed: { billingState: BillingState; pauseReason?: PauseReason } | null = null;
    if (u.status === "suspended") {
      seed = { billingState: BillingState.paused, pauseReason: PauseReason.non_payment };
    } else if (u.status === "inactive") {
      seed = { billingState: BillingState.inactive };
    } else {
      unseeded.push(`${u.id} ${maskEmail(u.email)} (status=${u.status})`);
    }

    const base = {
      contactId: u.ghlContactId as string,
      locationId: u.ghlLocationId,
      warningCount: u.warningCount,
      onboardingStage: u.onboardingStage,
      locationToken: u.ghlLocationToken,
      locationTokenExpires: u.ghlLocationTokenExpiresAt,
    };
    const stateFields = seed ?? {};
    if (seed) seededCount++;

    if (existing.has(u.id)) updated++;
    else created++;

    if (apply) {
      await prisma.ghlAccount.upsert({
        where: { userId: u.id },
        create: { userId: u.id, ...base, ...stateFields },
        update: { ...base, ...stateFields },
      });
    }
  }

  console.log(`\n${apply ? "Applied" : "Would apply"}: created=${created} updated=${updated} skipped=${skipped}`);
  console.log(`Billing state set by status rules: ${seededCount}`);
  const byStatus: Record<string, number> = {};
  for (const l of unseeded) {
    const st = l.match(/status=(.*)\)$/)?.[1] ?? "?";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }
  console.log(`Left null (not yet seeded): ${unseeded.length}`, byStatus);
}

main().finally(() => prisma.$disconnect());
