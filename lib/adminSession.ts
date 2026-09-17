// Admin-portal auth — deliberately separate from lib/toolsSession.ts (the
// member OTP/A2P flow). Admin login is email+password against
// User.passwordHash; the seeded admin has no a2pPhone/ghlContactId path in,
// so it can never resolve through resolveActiveMember(). Same JWT pattern
// (jose, HS256) but its own cookie name/secret scope so the two sessions
// never collide or get read by the wrong verifier.

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import type { PrismaClient, Role } from "@prisma/client";

export const ADMIN_SESSION_COOKIE = "reiblast_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12h — shorter-lived than the member session

export type AdminSessionPayload = {
  userId: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.TOOLS_SESSION_SECRET;
  if (!secret) {
    throw new Error("TOOLS_SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret + ":admin");
}

export async function signAdminSession(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyAdminSession(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export type AdminContext = {
  userId: string;
  role: Role;
};

export class RequireAdminError extends Error {}

/**
 * Every /admin route (page or API) sits behind this. Thin wrapper over the
 * admin session cookie — gated on role === 'admin' ONLY. manager/team_lead
 * exist in the Role enum but have no defined admin-portal perms yet.
 */
export async function requireAdmin(prisma: PrismaClient, req?: NextRequest): Promise<AdminContext> {
  const token = req ? req.cookies.get(ADMIN_SESSION_COOKIE)?.value : (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) {
    throw new RequireAdminError("No admin session cookie");
  }

  const session = await verifyAdminSession(token);
  if (!session) {
    throw new RequireAdminError("Invalid or expired admin session");
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.role !== "admin") {
    throw new RequireAdminError("Not an admin");
  }

  return { userId: user.id, role: user.role };
}
