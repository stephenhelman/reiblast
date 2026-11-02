import { SignJWT, jwtVerify } from "jose";

export const FOUNDERS_SESSION_COOKIE = "founders_session";
export const FOUNDERS_SESSION_MAX_AGE_SECONDS = 30 * 60;
export type FoundersSessionPayload = { userId: string; ghlAccountId: string };

/** Host-only (no Domain), httpOnly, secure, lax, scoped to /founders, 30 minutes. */
export const FOUNDERS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/founders",
  maxAge: FOUNDERS_SESSION_MAX_AGE_SECONDS,
};

function secret(): Uint8Array {
  const s = process.env.FOUNDERS_SESSION_SECRET;
  if (!s) throw new Error("FOUNDERS_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signFoundersSession(p: FoundersSessionPayload): Promise<string> {
  return new SignJWT({ userId: p.userId, ghlAccountId: p.ghlAccountId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("founders-session")
    .setExpirationTime(`${FOUNDERS_SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifyFoundersSession(token: string): Promise<FoundersSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], audience: "founders-session" });
    return typeof payload.userId === "string" && typeof payload.ghlAccountId === "string" ? { userId: payload.userId, ghlAccountId: payload.ghlAccountId } : null;
  } catch {
    return null;
  }
}
