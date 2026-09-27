import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { ADMIN_BASE_HEADER, ADMIN_COOKIE } from "./config";
import { isAdminContextHost } from "./hostRouting";
import { AdminAuthError, checkOwnerToken, type OwnerContext } from "./ownerCheck";

export { AdminAuthError, type OwnerContext };

/**
 * The single owner check. Call it in every admin page, server action and /api/admin handler (middleware does NOT cover
 * /api). Verifies the host is an admin host, then re-verifies the token AND the account/allowlist/user state in the DB.
 * Throws AdminAuthError.
 */
export async function requireOwner(req?: NextRequest): Promise<OwnerContext> {
  const host = (req ? req.headers.get("host") : (await headers()).get("host")) ?? "";
  if (!isAdminContextHost(host, { VERCEL_ENV: process.env.VERCEL_ENV, ADMIN_PATH_ACCESS: process.env.ADMIN_PATH_ACCESS })) throw new AdminAuthError("not an admin host");
  const token = req ? req.cookies.get(ADMIN_COOKIE)?.value : (await cookies()).get(ADMIN_COOKIE)?.value;
  return checkOwnerToken(token, await getBillingDb());
}

/** Pages / layouts / server actions: redirect to the fallback login instead of throwing. */
export async function requireOwnerOrRedirect(): Promise<OwnerContext> {
  try {
    return await requireOwner();
  } catch (err) {
    if (!(err instanceof AdminAuthError)) console.error("[admin] owner check error:", err instanceof Error ? err.message : err);
    redirect(`${(await headers()).get(ADMIN_BASE_HEADER) ?? ""}/login`);
  }
}

/** /api/admin handlers: `const r = await ownerOr401(req); if (r instanceof NextResponse) return r;` */
export async function ownerOr401(req: NextRequest): Promise<OwnerContext | NextResponse> {
  try {
    return await requireOwner(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
