import { NextRequest } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { mintOtp } from "@/lib/otp";
import { fetchContactPhoneLast4 } from "@/lib/discord/ghlContact";
import { runDiscordEndpoint } from "@/lib/discord/http";
import { handleVerifyStart, parseIdentity, type VerifyDb } from "@/lib/discord/verify";

// Discord bot → server: start verification (look up the member, send a one-time code to the personal phone on file).
// The DiscordVerifyAttempt row written inside handleVerifyStart is this route's record-before-act.
export async function POST(req: NextRequest) {
  return runDiscordEndpoint(req, "discord/verify/start", async (body) => {
    const input = parseIdentity(body);
    if (!input) return null;
    const db = (await getBillingDb()) as unknown as VerifyDb;
    return handleVerifyStart({ db, mintOtp, fetchPhoneLast4: fetchContactPhoneLast4 }, input);
  });
}
