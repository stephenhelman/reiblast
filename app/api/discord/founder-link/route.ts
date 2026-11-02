import { NextRequest } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { runDiscordEndpoint } from "@/lib/discord/http";
import { handleFounderLink, parseFounderLinkBody, type FounderLinkDb } from "@/lib/founderOffer/linkEndpoint";

// Discord bot → server: mint a personal, signed claim link for a verified member ("Claim my spot" button in #founders-claim).
export async function POST(req: NextRequest) {
  return runDiscordEndpoint(req, "discord/founder-link", async (body) => {
    const input = parseFounderLinkBody(body);
    if (!input) return null;
    return handleFounderLink({ db: (await getBillingDb()) as unknown as FounderLinkDb }, input);
  });
}
