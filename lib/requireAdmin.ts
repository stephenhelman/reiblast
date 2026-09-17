// Admin gate — NOT a separate front door. Admin wraps the NORMAL tools
// session (?locationId={} -> account lookup -> OTP -> session, see
// app/tools/enter/) and simply checks role === 'admin' on the resolved
// member. There is no separate admin cookie/JWT; go-live for admin auth is
// unstubbing the OTP send in app/tools/enter (lib/otp.ts mintOtpDevStub),
// not swapping this model out for something else.

import { NextRequest } from "next/server";
import type { PrismaClient, Role } from "@prisma/client";
import { requireMember, RequireMemberError } from "@/lib/requireMember";
import { resolveSessionMember } from "@/lib/toolsSession";

export class RequireAdminError extends Error {}

export type AdminContext = {
  userId: string;
  locationId: string;
  role: Role;
};

/**
 * Every /admin route (page or API) sits behind this. Thin wrapper over the
 * normal member session — gated on role === 'admin' ONLY. manager/team_lead
 * exist in the Role enum but have no defined admin-portal perms yet.
 *
 * Pass `req` from a Route Handler (reads the session cookie off the
 * request); omit it from a Server Component (reads via next/headers).
 */
export async function requireAdmin(prisma: PrismaClient, req?: NextRequest): Promise<AdminContext> {
  if (req) {
    try {
      const member = await requireMember(req);
      if (member.role !== "admin") throw new RequireAdminError("Not an admin");
      return member;
    } catch (err) {
      if (err instanceof RequireMemberError) throw new RequireAdminError(err.message);
      throw err;
    }
  }

  const member = await resolveSessionMember(prisma);
  if (!member || member.role !== "admin") {
    throw new RequireAdminError("Not an admin");
  }
  return member;
}
