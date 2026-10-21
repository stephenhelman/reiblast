import { NextRequest, NextResponse } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { checkSecret, missingEnvVars, logInternalError, type Reason } from "@/lib/billing/reason";
import { mintOtp } from "@/lib/otp";
import { fetchContactPhoneLast4 } from "@/lib/discord/ghlContact";
import { handleVerifyStart, parseIdentity, type VerifyDb } from "@/lib/discord/verify";

// Discord bot → server: start verification (look up the member, send a one-time code to the personal phone on file).
// Always HTTP 200 with a reason code. Logs reason codes only — never emails, phone numbers, codes, Discord ids or secrets.
// The DiscordVerifyAttempt row written inside handleVerifyStart is this route's record-before-act.

const respond = (body: { result: string; reason: Reason; [k: string]: unknown }) => NextResponse.json(body);
const error = (reason: Reason) => {
  console.log(`[discord/verify/start] reason=${reason}`);
  return respond({ result: "error", reason });
};

export async function POST(req: NextRequest) {
  try {
    const auth = checkSecret(req.headers.get("x-reiblast-discord-secret"), "DISCORD_BOT_INBOUND_SECRET");
    if (auth === "misconfigured") {
      console.error("[discord/verify/start] missing required env var(s):", missingEnvVars(["DISCORD_BOT_INBOUND_SECRET"]).join(", "));
      return error("server_misconfigured");
    }
    if (auth === "missing") return error("auth_missing");
    if (auth === "failed") return error("auth_failed");

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return error("bad_json");
    }
    const input = parseIdentity(body);
    if (!input) return error("bad_request");

    const db = (await getBillingDb()) as unknown as VerifyDb;
    const out = await handleVerifyStart({ db, mintOtp, fetchPhoneLast4: fetchContactPhoneLast4 }, input);
    console.log(`[discord/verify/start] reason=${out.reason}`);
    return respond(out);
  } catch (err) {
    logInternalError("discord/verify/start", err);
    return error("internal_error");
  }
}
