import { createHash, timingSafeEqual } from "crypto";

/** Timing-safe secret check. Hashing both sides means equal-length buffers, so a length mismatch can't throw or leak. */
export function secretMatches(incoming: string | null, envName: string): boolean {
  const expected = process.env[envName];
  if (!incoming || !expected) return false;
  return timingSafeEqual(createHash("sha256").update(incoming).digest(), createHash("sha256").update(expected).digest());
}
