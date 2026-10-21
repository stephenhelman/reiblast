import type { PrismaClient } from "@prisma/client";

/**
 * Bot → server unlink: the member left or asked to unlink, and the bot has removed (or is removing) the role itself, so this only
 * deletes the DiscordLink — no revoke outbox row (docs/discord-bot-contract.md). Idempotent: deleteMany, never a throwing delete.
 */
export type UnlinkDb = Pick<PrismaClient, "discordLink">;
export type UnlinkResponse = { result: "unlinked" | "not_linked"; reason: "unlinked" | "not_linked" };

/** Validates an unlink body: only `discordUserId` (a 15–25 digit snowflake string) matters. Null → caller answers bad_request. */
export function parseUnlink(body: Record<string, unknown>): { discordUserId: string } | null {
  const { discordUserId } = body;
  return typeof discordUserId === "string" && /^\d{15,25}$/.test(discordUserId) ? { discordUserId } : null;
}

export async function handleUnlink(db: UnlinkDb, { discordUserId }: { discordUserId: string }): Promise<UnlinkResponse> {
  const { count } = await db.discordLink.deleteMany({ where: { discordUserId } });
  return count > 0 ? { result: "unlinked", reason: "unlinked" } : { result: "not_linked", reason: "not_linked" };
}
