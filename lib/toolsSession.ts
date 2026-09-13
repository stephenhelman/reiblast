import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import { TOOLS_SESSION_COOKIE, TOOLS_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

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

// TEMP DIAGNOSTIC — remove once session persistence is confirmed working.
// Fingerprints the secret (never logs the secret itself) so sign-time and
// verify-time can be compared across runtimes/deploys.
async function secretFingerprint(): Promise<string> {
  const secret = process.env.TOOLS_SESSION_SECRET;
  if (!secret) return "MISSING";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `len=${secret.length} fp=${hex}`;
}

export async function signToolsSession(payload: ToolsSessionPayload): Promise<string> {
  console.log("[toolsSession] signing with secret", await secretFingerprint());
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOOLS_SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyToolsSession(token: string): Promise<ToolsSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    console.log("[toolsSession] verify OK with secret", await secretFingerprint());
    if (typeof payload.userId !== "string" || typeof payload.locationId !== "string") {
      console.log("[toolsSession] verify failed: payload missing userId/locationId", payload);
      return null;
    }
    return { userId: payload.userId, locationId: payload.locationId };
  } catch (err) {
    console.log(
      "[toolsSession] verify FAILED with secret",
      await secretFingerprint(),
      "error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * The single session -> real member bridge. Reads the tools session cookie,
 * verifies it, and validates the embedded userId still resolves to a real
 * User row — fail-closed (a deleted/bad user resolves to null, not a stale
 * id) rather than trusting the token payload blindly. signToolsSession()
 * already sets `userId` to the real User.id at /enter time (see
 * app/tools/enter/actions.ts), so no further locationId -> User lookup is
 * needed here.
 *
 * lib/catalog.ts, lib/launcherCatalog.ts, and lib/storeCatalog.ts each used
 * to stub this out independently with a "not wired up yet" TODO; this is the
 * one place all three now point at, restoring the single-member-source intent.
 *
 * Split into a cookie-reading wrapper and a token-only core so the core can
 * be exercised in tests without a Next.js request scope (cookies() throws
 * outside one).
 */
export async function resolveUserIdFromToken(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;

  const session = await verifyToolsSession(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return null;

  return user.id;
}

export async function resolveSessionUserId(prisma: PrismaClient): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOOLS_SESSION_COOKIE)?.value;
  return resolveUserIdFromToken(prisma, token);
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
