import { SignJWT, jwtVerify } from "jose";
import { TOOLS_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

export type ToolsSessionPayload = {
  userId: string;
  locationId: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.TOOLS_SESSION_SECRET;
  if (!secret) {
    throw new Error("TOOLS_SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function signToolsSession(payload: ToolsSessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOOLS_SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyToolsSession(token: string): Promise<ToolsSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string" || typeof payload.locationId !== "string") {
      return null;
    }
    return { userId: payload.userId, locationId: payload.locationId };
  } catch {
    return null;
  }
}

/**
 * Cookie `domain` must key off the ACTUAL runtime request host, not a
 * build-time constant — a production domain attribute on a cookie set while
 * serving localhost is silently dropped by the browser, and the session
 * would never persist in dev. Needs verification in both dev and prod.
 */
export function toolsCookieDomain(host: string): string | undefined {
  const hostname = host.split(":")[0];
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return undefined;
  }
  return "tools.reiblast.app";
}
