import { NextRequest } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { verifyOtp } from "@/lib/otp";
import { runDiscordEndpoint } from "@/lib/discord/http";
import { handleVerifyConfirm, parseConfirm, type ConfirmDb } from "@/lib/discord/verify";

// Discord bot → server: confirm the one-time code and create the DiscordLink. Idempotent for the same member + Discord id.
// The DiscordVerifyAttempt row written inside handleVerifyConfirm is this route's record-before-act.
export async function POST(req: NextRequest) {
  return runDiscordEndpoint(req, "discord/verify/confirm", async (body) => {
    const input = parseConfirm(body);
    if (!input) return null;
    const db = (await getBillingDb()) as unknown as ConfirmDb;
    return handleVerifyConfirm({ db, verifyOtp }, input);
  });
}
