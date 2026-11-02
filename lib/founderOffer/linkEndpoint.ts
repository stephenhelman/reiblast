import type { Reason } from "@/lib/billing/reason";
import { founderUrls } from "./urls";
import { signFounderLink } from "./linkToken";

export const LINK_WINDOW_MS = 60 * 1000;
export const MAX_LINKS_PER_MINUTE = 5;
export const NOT_VERIFIED_MESSAGE = "Verify in #verify first, then press Claim again.";
export const LINK_MESSAGE = "Here is your personal claim link. It works for 30 minutes.";

export type FounderLinkDb = {
  discordLink: { findUnique(args: any): Promise<{ ghlAccountId: string } | null> };
  founderVerifyAttempt: { create(args: any): Promise<unknown>; count(args: any): Promise<number> };
};

export type FounderLinkResponse =
  | { result: "ok"; reason: Extract<Reason, "link_issued">; url: string; message: string }
  | { result: "not_verified"; reason: Extract<Reason, "not_verified">; message: string }
  | { result: "refused"; reason: Extract<Reason, "rate_limited"> };

export const parseFounderLinkBody = (body: Record<string, unknown>): { discordUserId: string } | null =>
  typeof body.discordUserId === "string" && /^\d{15,25}$/.test(body.discordUserId) ? { discordUserId: body.discordUserId } : null;

/**
 * Discord bot → server: DiscordLink → GhlAccount → signed 30-minute link. No eligibility or window check (the page does that).
 * Only a linked Discord id leaves a "link" attempt row (FounderVerifyAttempt needs a ghlAccountId), so the 5/minute limit applies
 * to linked members; an unlinked caller gets the same cheap read-only answer every time.
 */
export async function handleFounderLink(
  deps: { db: FounderLinkDb; now?: () => Date; sign?: typeof signFounderLink },
  { discordUserId }: { discordUserId: string },
): Promise<FounderLinkResponse> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const link = await db.discordLink.findUnique({ where: { discordUserId }, select: { ghlAccountId: true } });
  if (!link) return { result: "not_verified", reason: "not_verified", message: NOT_VERIFIED_MESSAGE };

  await db.founderVerifyAttempt.create({ data: { kind: "link", ghlAccountId: link.ghlAccountId, discordUserId, createdAt: now } });
  const recent = await db.founderVerifyAttempt.count({ where: { kind: "link", discordUserId, createdAt: { gte: new Date(now.getTime() - LINK_WINDOW_MS) } } });
  if (recent > MAX_LINKS_PER_MINUTE) return { result: "refused", reason: "rate_limited" };

  const token = await (deps.sign ?? signFounderLink)({ ghlAccountId: link.ghlAccountId, discordUserId });
  return { result: "ok", reason: "link_issued", url: `${founderUrls().claim}?t=${encodeURIComponent(token)}`, message: LINK_MESSAGE };
}
