import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, verifyTotp } from "../totp";

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890" (ASCII). The RFC lists 8-digit codes; 6-digit = last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("TOTP (RFC 6238)", () => {
  it("base32 of the RFC secret", () => expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));

  it.each(VECTORS)("test vector at t=%i → %s", (t, code) => {
    expect(totpAt(RFC_SECRET, t * 1000)).toBe(code);
    expect(verifyTotp(RFC_SECRET, code, t * 1000).ok).toBe(true);
  });

  it("base32 round-trips", () => {
    const buf = Buffer.from("hello world, admin!");
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts ±1 step and rejects ±2", () => {
    const t = 1111111109 * 1000;
    const code = totpAt(RFC_SECRET, t);
    expect(verifyTotp(RFC_SECRET, code, t + 30_000).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, t - 30_000).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, t + 60_000).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, code, t - 60_000).ok).toBe(false);
  });

  it("rejects wrong / malformed codes and a bad secret", () => {
    const t = 59_000;
    expect(verifyTotp(RFC_SECRET, "000000", t).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "28708", t).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", t).ok).toBe(false);
    expect(verifyTotp("not base32!!", "287082", t).ok).toBe(false);
  });

  it("replay protection: a step at or before afterStep is rejected", () => {
    const t = 1111111109 * 1000;
    const first = verifyTotp(RFC_SECRET, "081804", t);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(verifyTotp(RFC_SECRET, "081804", t, { afterStep: first.step }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "081804", t, { afterStep: first.step - 1 }).ok).toBe(true);
  });

  it("builds an otpauth URI", () => {
    const u = otpauthUri("ABC234", "owner");
    expect(u).toMatch(/^otpauth:\/\/totp\/REIblast%20Admin%3Aowner\?secret=ABC234&issuer=REIblast%20Admin&algorithm=SHA1&digits=6&period=30$/);
  });
});
