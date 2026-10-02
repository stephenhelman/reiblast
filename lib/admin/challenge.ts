import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS, OTP_SEND_WINDOW_MS, OTP_TTL_MS } from "./config";
import { hmacHex, randomCode6, safeEqualHex } from "./crypto";

type Db = Pick<PrismaClient, "adminAuthChallenge">;

/** Bound to the challenge id so a hash can't be replayed across challenges. */
export const hashOtp = (challengeId: string, code: string, env?: Record<string, string | undefined>): string => hmacHex(`admin-otp:${challengeId}:${code}`, env);

export type IssueResult = { ok: true; id: string; code: string } | { ok: false; reason: "rate_limited" };

/** Max OTP_MAX_SENDS challenges per OTP_SEND_WINDOW_MS (counted from AdminAuthChallenge.createdAt). Supersedes any live challenge. */
export async function issueChallenge(db: Db, now = new Date(), env?: Record<string, string | undefined>): Promise<IssueResult> {
  const sends = await db.adminAuthChallenge.count({ where: { createdAt: { gte: new Date(now.getTime() - OTP_SEND_WINDOW_MS) } } });
  if (sends >= OTP_MAX_SENDS) return { ok: false, reason: "rate_limited" };

  await db.adminAuthChallenge.updateMany({ where: { consumedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  const id = randomUUID();
  const code = randomCode6();
  await db.adminAuthChallenge.create({ data: { id, method: "sms", codeHash: hashOtp(id, code, env), expiresAt: new Date(now.getTime() + OTP_TTL_MS) } });
  return { ok: true, id, code };
}

/** The SMS could not be delivered: remove the challenge so the (never-delivered) code is unusable. */
export async function discardChallenge(db: Db, id: string): Promise<void> {
  await db.adminAuthChallenge.deleteMany({ where: { id } });
}

export async function hasRecentLiveChallenge(db: Db, withinMs: number, now = new Date()): Promise<boolean> {
  const c = await db.adminAuthChallenge.findFirst({ where: { consumedAt: null, expiresAt: { gt: now }, createdAt: { gte: new Date(now.getTime() - withinMs) } } });
  return !!c;
}

export type VerifyChallengeResult = { ok: true } | { ok: false; reason: "no_challenge" | "locked" | "wrong" | "invalid" };

/**
 * Checks `code` against the newest live challenge. The attempt is claimed atomically BEFORE comparing (so concurrent
 * guesses can't exceed OTP_MAX_ATTEMPTS), the compare is constant-time, and success consumes the challenge exactly once.
 */
export async function verifyChallenge(db: Db, code: string, now = new Date(), env?: Record<string, string | undefined>): Promise<VerifyChallengeResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid" };
  const ch = await db.adminAuthChallenge.findFirst({ where: { consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  if (!ch) return { ok: false, reason: "no_challenge" };

  const claimed = await db.adminAuthChallenge.updateMany({
    where: { id: ch.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return { ok: false, reason: "locked" };

  if (!safeEqualHex(ch.codeHash, hashOtp(ch.id, code, env))) return { ok: false, reason: "wrong" };

  const consumed = await db.adminAuthChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: now } });
  return consumed.count === 1 ? { ok: true } : { ok: false, reason: "no_challenge" };
}
