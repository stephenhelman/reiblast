import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyToolsSession } from "@/lib/toolsSession";
import { TOOLS_SESSION_COOKIE } from "@/lib/constants";

export type MemberContext = {
  userId: string;
  locationId: string;
};

export class RequireMemberError extends Error {}

/**
 * Resolves the verified tools session cookie into a trusted member context.
 * NEVER reads locationId from the URL/query — only from the signed cookie.
 * Re-checks status === 'active' at call time (not just at session-mint time).
 * Throws RequireMemberError on any failure; callers should catch and return 401.
 */
export async function requireMember(req: NextRequest): Promise<MemberContext> {
  const token = req.cookies.get(TOOLS_SESSION_COOKIE)?.value;
  if (!token) {
    throw new RequireMemberError("No session cookie");
  }

  const session = await verifyToolsSession(token);
  if (!session) {
    throw new RequireMemberError("Invalid or expired session");
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "active" || user.ghlLocationId !== session.locationId) {
    throw new RequireMemberError("Member is not active or session mismatch");
  }

  return { userId: user.id, locationId: session.locationId };
}

/**
 * Same checks as requireMember, for server components / actions (reads the cookie via next/headers). Returns null instead of throwing.
 * locationId comes ONLY from the verified session cookie.
 */
export async function getMemberFromCookies(): Promise<MemberContext | null> {
  const token = (await cookies()).get(TOOLS_SESSION_COOKIE)?.value;
  const session = token ? await verifyToolsSession(token) : null;
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "active" || user.ghlLocationId !== session.locationId) return null;
  return { userId: user.id, locationId: session.locationId };
}
