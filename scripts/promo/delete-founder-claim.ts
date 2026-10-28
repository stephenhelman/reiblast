/**
 * Delete a Founder's Offer claim (your own end-to-end test claim) so the slot and the member are clean again. Dry-run by default.
 *
 *   npx tsx scripts/promo/delete-founder-claim.ts --token <claimToken>        [--apply]
 *   npx tsx scripts/promo/delete-founder-claim.ts --contact <hqContactId>     [--apply]
 *   (also accepts --token=<t> / --contact=<id>)
 *
 * Production: DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx ... --i-mean-production [--apply] (shared connect() guard: typed host
 * confirmation, interactive only). Deletes, in ONE transaction: the FounderClaim, its founder intents (GhlIntent `founder:<claimId>:*`)
 * and the member's FounderVerifyAttempt rows (so OTP rate limits reset). The member, the GhlAccount and every other row are untouched.
 * If the claim is the free winner, the next claimant becomes the first founder again, as intended for a test claim.
 */
import { connect } from "../billing/_cli";

const flag = (name: string): string | undefined => {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  return (a.includes("=") ? a.slice(a.indexOf("=") + 1) : process.argv[i + 1])?.trim();
};

const token = flag("token");
const contact = flag("contact");
if (!!token === !!contact) throw new Error("usage: delete-founder-claim.ts (--token <claimToken> | --contact <hqContactId>) [--apply]");

async function main() {
  const { db, apply } = await connect();
  try {
    await run(db, apply);
  } finally {
    await db.$disconnect();
  }
}

async function run(db: Awaited<ReturnType<typeof connect>>["db"], apply: boolean) {
  const claim = await db.founderClaim.findFirst({
    where: token ? { token } : { ghlAccount: { contactId: contact } },
    select: { id: true, token: true, ghlAccountId: true, claimNumber: true, status: true, isFirst: true, attempt: true, invoiceId: true, ghlAccount: { select: { contactId: true } } },
  });
  if (!claim) return console.log("No matching FounderClaim. Nothing to do.");
  const intentWhere = { dedupeKey: { startsWith: `founder:${claim.id}:` } };
  const [intents, attempts] = await Promise.all([db.ghlIntent.count({ where: intentWhere }), db.founderVerifyAttempt.count({ where: { ghlAccountId: claim.ghlAccountId } })]);

  console.log(`FounderClaim ${claim.id}  #${claim.claimNumber}  ${claim.status}${claim.isFirst ? " (first)" : ""}  attempt ${claim.attempt}  contact ${claim.ghlAccount.contactId}`);
  console.log(`  invoice: ${claim.invoiceId ?? "none"}`);
  console.log(`  will delete: 1 FounderClaim, ${intents} GhlIntent, ${attempts} FounderVerifyAttempt`);
  if (claim.status === "PAID") console.log("  WARNING: this claim is PAID. Real money may have moved; refund it separately.");
  if (!apply) return console.log("\nDry-run: nothing deleted. Re-run with --apply.");

  const done = await db.$transaction(async (tx) => ({
    intents: (await tx.ghlIntent.deleteMany({ where: intentWhere })).count,
    attempts: (await tx.founderVerifyAttempt.deleteMany({ where: { ghlAccountId: claim.ghlAccountId } })).count,
    claims: (await tx.founderClaim.deleteMany({ where: { id: claim.id } })).count,
  }));
  console.log(`\nDeleted: ${done.claims} FounderClaim, ${done.intents} GhlIntent, ${done.attempts} FounderVerifyAttempt.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
