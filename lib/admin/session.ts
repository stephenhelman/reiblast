import { SignJWT, jwtVerify } from "jose";
import { ADMIN_SESSION_TTL_SECONDS } from "./config";

/** Edge-safe (jose only): imported by middleware.ts as well as node code. */
export type AdminSessionPayload = {
  /** GhlAccount.id of the internal owner account. */
  sub: string;
  locationId: string;
  method: "sms" | "totp" | "backup";
};

export class AdminConfigError extends Error {}

const ISSUER = "reiblast-admin";
const MIN_SECRET_LENGTH = 32;

/** Fails closed: missing, too short, or identical to TOOLS_SESSION_SECRET → throw. */
export function getAdminSecret(env: Record<string, string | undefined> = process.env): Uint8Array {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) throw new AdminConfigError("ADMIN_SESSION_SECRET is not set");
  if (secret.length < MIN_SECRET_LENGTH) throw new AdminConfigError(`ADMIN_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  if (env.TOOLS_SESSION_SECRET && secret === env.TOOLS_SESSION_SECRET) throw new AdminConfigError("ADMIN_SESSION_SECRET must differ from TOOLS_SESSION_SECRET");
  return new TextEncoder().encode(secret);
}

export async function signAdminSession(payload: AdminSessionPayload, env: Record<string, string | undefined> = process.env): Promise<string> {
  return new SignJWT({ locationId: payload.locationId, method: payload.method })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(getAdminSecret(env));
}

/** Returns null on ANY problem, including misconfiguration (fail closed). */
export async function verifyAdminSession(token: string, env: Record<string, string | undefined> = process.env): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAdminSecret(env), { issuer: ISSUER, algorithms: ["HS256"] });
    const { sub, locationId, method } = payload as { sub?: unknown; locationId?: unknown; method?: unknown };
    if (typeof sub !== "string" || typeof locationId !== "string") return null;
    if (method !== "sms" && method !== "totp" && method !== "backup") return null;
    return { sub, locationId, method };
  } catch {
    return null;
  }
}
