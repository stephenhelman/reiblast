import { NextRequest } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { runDiscordEndpoint } from "@/lib/discord/http";
import { handleUnlink, parseUnlink } from "@/lib/discord/unlink";

// Discord bot → server: delete the DiscordLink for a Discord account. No outbox — the bot removes the role itself once this answers.
export async function POST(req: NextRequest) {
  return runDiscordEndpoint(req, "discord/unlink", async (body) => {
    const input = parseUnlink(body);
    if (!input) return null;
    return handleUnlink(await getBillingDb(), input);
  });
}
