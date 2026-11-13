import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { SCORECARD_TOKEN_TTL_SECONDS, ScorecardConfigError, getScorecardSecret, signScorecardToken, verifyScorecardToken } from "../token";

const SECRET = "s".repeat(40);
const env = { SCORECARD_TOKEN_SECRET: SECRET, TOOLS_SESSION_SECRET: "t".repeat(40), ADMIN_SESSION_SECRET: "a".repeat(40) };
const LOC = "LOCATION1234567890ab";
const enc = (s: string) => new TextEncoder().encode(s);
const T0 = new Date("2026-11-13T12:00:00Z");
const plus = (sec: number) => new Date(T0.getTime() + sec * 1000);

/** Hand-rolled token for negative cases. */
const forge = (claims: Record<string, unknown>, o: { secret?: string; issuer?: string | null; exp?: number } = {}) => {
  const iat = Math.floor(T0.getTime() / 1000);
  let j = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt(iat).setExpirationTime(o.exp ?? iat + 3600);
  if (o.issuer !== null) j = j.setIssuer(o.issuer ?? "reiblast-scorecard");
  return j.sign(enc(o.secret ?? SECRET));
};

describe("sign + verify", () => {
  it("round-trips the locationId", async () => {
    const t = await signScorecardToken(LOC, env, T0);
    expect(await verifyScorecardToken(t, env, plus(60))).toEqual({ ok: true, locationId: LOC });
  });
  it("expires after 14 days: valid just before, expired just after (and an expired token still names its location)", async () => {
    expect(SCORECARD_TOKEN_TTL_SECONDS).toBe(14 * 86400);
    const t = await signScorecardToken(LOC, env, T0);
    expect((await verifyScorecardToken(t, env, plus(SCORECARD_TOKEN_TTL_SECONDS - 1))).ok).toBe(true);
    expect(await verifyScorecardToken(t, env, plus(SCORECARD_TOKEN_TTL_SECONDS + 1))).toEqual({ ok: false, reason: "expired", locationId: LOC });
  });
  it("refuses an empty locationId", async () => {
    await expect(signScorecardToken("", env)).rejects.toThrow();
  });
});

describe("rejections are 'invalid' and never leak a location", () => {
  it("wrong purpose (e.g. a tools-style or other-purpose token with the right secret)", async () => {
    expect(await verifyScorecardToken(await forge({ locationId: LOC, purpose: "admin" }), env, T0)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyScorecardToken(await forge({ locationId: LOC }), env, T0)).toEqual({ ok: false, reason: "invalid" });
  });
  it("expired token with the wrong purpose does not reveal a location", async () => {
    const t = await forge({ locationId: LOC, purpose: "admin" }, { exp: Math.floor(T0.getTime() / 1000) + 10 });
    expect(await verifyScorecardToken(t, env, plus(3600))).toEqual({ ok: false, reason: "invalid" });
  });
  it("wrong secret (incl. a token signed with the tools secret)", async () => {
    expect(await verifyScorecardToken(await forge({ locationId: LOC, purpose: "scorecard" }, { secret: "x".repeat(40) }), env, T0)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyScorecardToken(await forge({ locationId: LOC, purpose: "scorecard" }, { secret: env.TOOLS_SESSION_SECRET }), env, T0)).toEqual({ ok: false, reason: "invalid" });
  });
  it("an expired token signed with the wrong secret is invalid, not expired", async () => {
    const t = await forge({ locationId: LOC, purpose: "scorecard" }, { secret: "x".repeat(40), exp: Math.floor(T0.getTime() / 1000) + 10 });
    expect(await verifyScorecardToken(t, env, plus(3600))).toEqual({ ok: false, reason: "invalid" });
  });
  it("wrong or missing issuer", async () => {
    expect((await verifyScorecardToken(await forge({ locationId: LOC, purpose: "scorecard" }, { issuer: "reiblast-admin" }), env, T0)).ok).toBe(false);
    expect((await verifyScorecardToken(await forge({ locationId: LOC, purpose: "scorecard" }, { issuer: null }), env, T0)).ok).toBe(false);
  });
  it("malformed payload (non-string / empty locationId)", async () => {
    expect((await verifyScorecardToken(await forge({ locationId: 123, purpose: "scorecard" }), env, T0)).ok).toBe(false);
    expect((await verifyScorecardToken(await forge({ locationId: "", purpose: "scorecard" }), env, T0)).ok).toBe(false);
  });
  it("only HS256: other algorithms and alg:none are refused", async () => {
    const hs512 = await new SignJWT({ locationId: LOC, purpose: "scorecard" }).setProtectedHeader({ alg: "HS512" }).setIssuer("reiblast-scorecard").setIssuedAt().setExpirationTime("1h").sign(enc(SECRET));
    expect((await verifyScorecardToken(hs512, env)).ok).toBe(false);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ locationId: LOC, purpose: "scorecard", iss: "reiblast-scorecard", exp: 9999999999 })}.`;
    expect((await verifyScorecardToken(none, env)).ok).toBe(false);
  });
  it("garbage and empty strings", async () => {
    for (const t of ["", "abc", "a.b.c", "a.b"]) expect(await verifyScorecardToken(t, env)).toEqual({ ok: false, reason: "invalid" });
  });
  it("a tampered payload fails the signature", async () => {
    const t = await signScorecardToken(LOC, env, T0);
    const [h, , s] = t.split(".");
    const p = Buffer.from(JSON.stringify({ locationId: "OTHERLOCATION12345678", purpose: "scorecard", iss: "reiblast-scorecard", exp: 9999999999 })).toString("base64url");
    expect((await verifyScorecardToken(`${h}.${p}.${s}`, env, T0)).ok).toBe(false);
  });
});

describe("secret handling fails closed", () => {
  it("missing / too short / equal to another signing secret → throws; verify returns invalid", async () => {
    expect(() => getScorecardSecret({})).toThrow(ScorecardConfigError);
    expect(() => getScorecardSecret({ SCORECARD_TOKEN_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => getScorecardSecret({ SCORECARD_TOKEN_SECRET: SECRET, TOOLS_SESSION_SECRET: SECRET })).toThrow(/TOOLS_SESSION_SECRET/);
    expect(() => getScorecardSecret({ SCORECARD_TOKEN_SECRET: SECRET, ADMIN_SESSION_SECRET: SECRET })).toThrow(/ADMIN_SESSION_SECRET/);
    expect(() => getScorecardSecret({ SCORECARD_TOKEN_SECRET: SECRET, FOUNDERS_SESSION_SECRET: SECRET })).toThrow(/FOUNDERS_SESSION_SECRET/);
    const good = await signScorecardToken(LOC, env, T0);
    expect(await verifyScorecardToken(good, { ...env, SCORECARD_TOKEN_SECRET: undefined }, T0)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyScorecardToken(good, { ...env, TOOLS_SESSION_SECRET: SECRET }, T0)).toEqual({ ok: false, reason: "invalid" });
    await expect(signScorecardToken(LOC, {}, T0)).rejects.toThrow(ScorecardConfigError);
  });
  it("accepts a valid secret that differs from the others", () => {
    expect(getScorecardSecret(env)).toBeInstanceOf(Uint8Array);
  });
});
