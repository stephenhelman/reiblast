"use server";

import { headers } from "next/headers";
import { resolveAriPromo, type AriTier } from "@/lib/ariPromo";

// In-memory limiter (resets on cold start), same approach as /api/promo/validate.
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (record.count >= 10) return true;
  record.count++;
  return false;
}

export type RedeemResult =
  | { ok: true; tier: AriTier }
  | { ok: false; error: "invalid" | "rate-limited" };

export async function redeemAriCode(code: string): Promise<RedeemResult> {
  const ip = headers().get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (isRateLimited(ip)) return { ok: false, error: "rate-limited" };

  const tier = resolveAriPromo(code);
  return tier ? { ok: true, tier } : { ok: false, error: "invalid" };
}
