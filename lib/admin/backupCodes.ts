import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { sha256Hex } from "./crypto";
import { base32Encode } from "./totp";

/**
 * 16 base32 chars = 80 bits, shown as XXXX-XXXX-XXXX-XXXX. High enough entropy that a plain SHA-256 is safe to store,
 * which also means hashes don't depend on any env secret (setup can run locally, verification on Vercel).
 */
export function generateBackupCode(): string {
  const raw = base32Encode(randomBytes(10)); // 10 bytes → 16 chars
  return raw.match(/.{4}/g)!.join("-");
}

export const normalizeBackupCode = (input: string): string => input.toUpperCase().replace(/[^A-Z2-7]/g, "");
export const hashBackupCode = (input: string): string => sha256Hex(`admin-backup:${normalizeBackupCode(input)}`);
export const looksLikeBackupCode = (input: string): boolean => normalizeBackupCode(input).length === 16;

type Db = Pick<PrismaClient, "adminBackupCode">;

/** Atomic consume-once: true only for the single caller that flips usedAt from null. */
export async function consumeBackupCode(db: Db, input: string, now = new Date()): Promise<boolean> {
  if (!looksLikeBackupCode(input)) return false;
  const res = await db.adminBackupCode.updateMany({ where: { codeHash: hashBackupCode(input), usedAt: null }, data: { usedAt: now } });
  return res.count === 1;
}
