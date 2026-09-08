import { NextRequest } from "next/server";
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
