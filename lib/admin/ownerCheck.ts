import type { PrismaClient } from "@prisma/client";
import { adminLocationIds } from "./config";
import { verifyAdminSession } from "./session";

type Db = Pick<PrismaClient, "ghlAccount">;
type Env = Record<string, string | undefined>;

export class AdminAuthError extends Error {}

export type OwnerContext = { accountId: string; locationId: string; userId: string; method: "sms" | "totp" | "backup" };

/**
 * Re-verifies the session on EVERY request (nothing is trusted from the cookie beyond its signature):
 * the account must still exist, still be `internal`, its locationId must still be allowlisted (and match the token),
 * and its User must still be `active`. No role checks anywhere.
 */
export async function checkOwnerToken(token: string | undefined, db: Db, env: Env = process.env): Promise<OwnerContext> {
  if (!token) throw new AdminAuthError("no session");
  const session = await verifyAdminSession(token, env);
  if (!session) throw new AdminAuthError("invalid session");
  if (!adminLocationIds(env).includes(session.locationId)) throw new AdminAuthError("location not allowlisted");

  const account = await db.ghlAccount.findUnique({ where: { id: session.sub }, select: { id: true, locationId: true, accountType: true, user: { select: { id: true, status: true } } } });
  if (!account || account.accountType !== "internal") throw new AdminAuthError("account missing or not internal");
  if (account.locationId !== session.locationId) throw new AdminAuthError("location mismatch");
  if (!account.user || account.user.status !== "active") throw new AdminAuthError("user not active");
  return { accountId: account.id, locationId: session.locationId, userId: account.user.id, method: session.method };
}
