import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getAdminSecret } from "./session";

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Keyed hash for OTP challenges; the key is ADMIN_SESSION_SECRET (fails closed if it is misconfigured). */
export function hmacHex(message: string, env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", getAdminSecret(env)).update(message).digest("hex");
}

/** Constant-time comparison of two hex digests; false on any length mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** 6 digits, uniformly random, zero-padded. */
export const randomCode6 = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");
