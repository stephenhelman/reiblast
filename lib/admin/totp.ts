import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s step) on node:crypto only. Secret is base32 (RFC 4648, no padding). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20)); // 160-bit, the RFC 4226 recommendation

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secretB32: string, nowMs: number): string {
  return hotp(base32Decode(secretB32), totpStep(nowMs));
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Accepts the current step ±1. `afterStep` (the last accepted step) makes every step ≤ it unusable, so a code can't be
 * replayed. All candidate steps are compared in constant time.
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, opts: { afterStep?: number } = {}): TotpResult {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  let secret: Buffer;
  try {
    secret = base32Decode(secretB32);
  } catch {
    return { ok: false };
  }
  const cur = totpStep(nowMs);
  let matched: number | null = null;
  for (const step of [cur - 1, cur, cur + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    const ok = timingSafeEqual(expected, Buffer.from(code)) && (opts.afterStep === undefined || step > opts.afterStep);
    if (ok && matched === null) matched = step;
  }
  return matched === null ? { ok: false } : { ok: true, step: matched };
}

export const otpauthUri = (secretB32: string, account: string, issuer = "REIblast Admin"): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
