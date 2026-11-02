/**
 * LOCAL PREVIEW ONLY: mint a 30-minute /founders/claim link for a member in the DEV database (refuses any other host).
 *
 *   npx tsx scripts/promo/mint-founder-link.ts <hqContactId> [--base http://localhost:3000]
 *
 * Reads .env.local (SEED_DATABASE_URL, FOUNDERS_LINK_SECRET). Read-only: prints eligibility and the URL, writes nothing, sends nothing.
 */
import dotenv from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { checkEligibility, loadEligibilityInput } from "../../lib/founderOffer/eligibility";
import { signFounderLink } from "../../lib/founderOffer/linkToken";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local"), quiet: true } as never);

async function main() {
  const contactId = process.argv[2];
  const baseIdx = process.argv.indexOf("--base");
  const base = (baseIdx > 0 ? process.argv[baseIdx + 1] : "http://localhost:3000").replace(/\/+$/, "");
  if (!contactId || contactId.startsWith("--")) throw new Error("usage: mint-founder-link.ts <hqContactId> [--base <url>]");
  const url = process.env.SEED_DATABASE_URL;
  if (!url || !url.includes("ep-super-shadow")) throw new Error("Refusing: SEED_DATABASE_URL is not the dev database.");

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const a = await db.ghlAccount.findUnique({ where: { contactId }, select: { id: true, user: { select: { name: true } }, founderClaim: { select: { status: true } }, discordLink: { select: { discordUserId: true } } } });
    if (!a) throw new Error("No GhlAccount with that contact id in dev.");
    // The token must carry the member's REAL linked Discord id: OTP start/confirm re-check that exact (account, discord id) link.
    if (!a.discordLink) throw new Error("This member has no DiscordLink in dev, so the OTP step would refuse the token (link_invalid). Pick a linked member.");
    console.log(`${a.user.name ?? "(no name)"} | account ${a.id} | existing claim: ${a.founderClaim?.status ?? "none"}`);
    console.log("eligibility:", JSON.stringify(checkEligibility(await loadEligibilityInput(db as never, a.id))));
    const token = await signFounderLink({ ghlAccountId: a.id, discordUserId: a.discordLink.discordUserId });
    console.log(`\n${base}/founders/claim?t=${encodeURIComponent(token)}\n`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
