import { SignJWT, jwtVerify } from "jose";

/**
 * Signed, short-lived link token for the emailed scorecard (/scorecard/view?t=…). Modeled on lib/admin/session.ts: jose HS256, its own
 * secret, an issuer, algorithms restricted on verify, payload shape validated, and it fails closed on any misconfiguration.
 * It is a BEARER token — anyone holding the link sees that one location's scorecard until it expires — so it carries nothing but the
 * location, is only valid for the scorecard (purpose claim), and is never accepted anywhere else (own secret + issuer + purpose).
 * jose only: edge-safe.
 */
export const SCORECARD_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
export const SCORECARD_PURPOSE = "scorecard";
const ISSUER = "reiblast-scorecard";
const MIN_SECRET_LENGTH = 32;
/** Used only to read the (still signature-verified) locationId out of an EXPIRED token, so the expired page can link to /enter. */
const EXPIRED_READ_TOLERANCE_SECONDS = 10 * 365 * 24 * 60 * 60;

export class ScorecardConfigError extends Error {}

type Env = Record<string, string | undefined>;

/** Fails closed: missing, too short, or equal to any other signing secret in this app → throw. */
export function getScorecardSecret(env: Env = process.env): Uint8Array {
  const secret = env.SCORECARD_TOKEN_SECRET;
  if (!secret) throw new ScorecardConfigError("SCORECARD_TOKEN_SECRET is not set");
  if (secret.length < MIN_SECRET_LENGTH) throw new ScorecardConfigError(`SCORECARD_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  for (const other of ["TOOLS_SESSION_SECRET", "ADMIN_SESSION_SECRET", "FOUNDERS_SESSION_SECRET"]) {
    if (env[other] && secret === env[other]) throw new ScorecardConfigError(`SCORECARD_TOKEN_SECRET must differ from ${other}`);
  }
  return new TextEncoder().encode(secret);
}

export async function signScorecardToken(locationId: string, env: Env = process.env, now: Date = new Date()): Promise<string> {
  if (!locationId) throw new Error("locationId is required");
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ locationId, purpose: SCORECARD_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SCORECARD_TOKEN_TTL_SECONDS)
    .sign(getScorecardSecret(env));
}

export type ScorecardTokenResult =
  | { ok: true; locationId: string }
  /** `locationId` is present only for an expired token whose signature, issuer and purpose all verified. */
  | { ok: false; reason: "expired"; locationId: string }
  | { ok: false; reason: "invalid" };

function shape(payload: Record<string, unknown>): string | null {
  const { locationId, purpose } = payload;
  return purpose === SCORECARD_PURPOSE && typeof locationId === "string" && locationId.length > 0 ? locationId : null;
}

/** Never throws. Misconfiguration, a bad signature, wrong issuer/purpose/algorithm, or a malformed payload are all "invalid". */
export async function verifyScorecardToken(token: string, env: Env = process.env, now: Date = new Date()): Promise<ScorecardTokenResult> {
  let secret: Uint8Array;
  try {
    secret = getScorecardSecret(env);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ["HS256"], currentDate: now });
    const locationId = shape(payload);
    return locationId ? { ok: true, locationId } : { ok: false, reason: "invalid" };
  } catch (err) {
    if ((err as { code?: unknown })?.code !== "ERR_JWT_EXPIRED") return { ok: false, reason: "invalid" };
  }
  // Expired: re-verify everything except the clock so only a genuinely-signed token can name a location.
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ["HS256"], currentDate: now, clockTolerance: EXPIRED_READ_TOLERANCE_SECONDS });
    const locationId = shape(payload);
    return locationId ? { ok: false, reason: "expired", locationId } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
