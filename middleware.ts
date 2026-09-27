import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToolsSession } from "@/lib/toolsSession";
import { TOOLS_SESSION_COOKIE } from "@/lib/constants";
import { ADMIN_BASE_HEADER, ADMIN_COOKIE } from "@/lib/admin/config";
import { isPublicAdminPath, resolveAdminRoute } from "@/lib/admin/hostRouting";
import { verifyAdminSession } from "@/lib/admin/session";
import {
  REGION_UNAVAILABLE_PATH,
  getCountry,
  isCountryAllowed,
  isGatedPath,
} from "@/lib/geo";

/**
 * REIblast admin (owner-only). `base` is "" on the admin host (public path == admin-relative path, rewritten under
 * /admin) and "/admin" when served by path on a preview host. Only a cheap signature check happens here (edge runtime);
 * requireOwner() does the authoritative per-request re-check in the page/action/API handler.
 */
async function handleAdmin(request: NextRequest, mode: "admin-host" | "preview-path"): Promise<NextResponse> {
  const base = mode === "preview-path" ? "/admin" : "";
  const rel = mode === "preview-path" ? request.nextUrl.pathname.slice("/admin".length) || "/" : request.nextUrl.pathname;

  if (!isPublicAdminPath(rel)) {
    const token = request.cookies.get(ADMIN_COOKIE)?.value;
    const session = token ? await verifyAdminSession(token) : null;
    if (!session) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = `${base}/login`;
      loginUrl.search = "";
      return NextResponse.redirect(loginUrl);
    }
  }

  const headers = new Headers(request.headers);
  headers.set(ADMIN_BASE_HEADER, base);
  const res =
    mode === "preview-path"
      ? NextResponse.next({ request: { headers } })
      : NextResponse.rewrite(Object.assign(request.nextUrl.clone(), { pathname: `/admin${rel === "/" ? "" : rel}` }), { request: { headers } });
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  const adminRoute = resolveAdminRoute({
    host: hostname,
    pathname,
    env: { VERCEL_ENV: process.env.VERCEL_ENV, ADMIN_PATH_ACCESS: process.env.ADMIN_PATH_ACCESS },
  });
  if (adminRoute.kind === "blocked") return new NextResponse("Not Found", { status: 404 }); // /admin on any non-admin host
  if (adminRoute.kind === "admin-host" || adminRoute.kind === "preview-path") return handleAdmin(request, adminRoute.kind);

  const isToolsHost =
    hostname.startsWith("tools.") ||
    hostname === "tools.reiblast.app" ||
    hostname === "localhost:3001";

  if (isToolsHost) {
    // /enter (and its verify/resend actions) is the only unauthenticated tool route —
    // it's what mints the session in the first place. Every other tool route,
    // widgets included, now requires a valid session. No public tool routes remain.
    const isEnterRoute = pathname === "/enter" || pathname.startsWith("/enter/");

    if (!isEnterRoute) {
      const token = request.cookies.get(TOOLS_SESSION_COOKIE)?.value;
      // TEMP DIAGNOSTIC — remove once session persistence is confirmed working.
      console.log(
        "[middleware] tools route",
        pathname,
        "cookie present:",
        !!token,
        "cookie length:",
        token?.length ?? 0,
      );
      const session = token ? await verifyToolsSession(token) : null;
      console.log("[middleware] session valid:", !!session, session ? { userId: session.userId, locationId: session.locationId } : null);

      if (!session) {
        const expiredUrl = request.nextUrl.clone();
        expiredUrl.pathname = "/tools/session-expired";
        expiredUrl.search = "";
        return NextResponse.rewrite(expiredUrl);
      }
    }

    const toolsUrl = request.nextUrl.clone();
    toolsUrl.pathname = `/tools${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(toolsUrl);
  }

  // Marketing site — all other hostnames

  // US-only gate on the paid funnel. Scoped to the checkout/onboarding entry
  // points in GATED_PREFIXES; the rest of the marketing site stays globally
  // viewable. This runs at the edge before the rewrite, so a gated route is
  // unreachable by direct URL for a blocked visitor — not merely hidden in the UI.
  //
  // Scoping lives here rather than in `config.matcher` because this middleware's
  // matcher is load-bearing: it must keep matching every path to perform the
  // host-based /marketing and /tools rewrites below. Narrowing the matcher to the
  // checkout paths would stop the rest of the site from resolving at all.
  if (isGatedPath(pathname) && !isCountryAllowed(getCountry(request))) {
    const blockedUrl = request.nextUrl.clone();
    blockedUrl.pathname = REGION_UNAVAILABLE_PATH;
    blockedUrl.search = "";
    return NextResponse.redirect(blockedUrl);
  }

  const marketingUrl = request.nextUrl.clone();
  marketingUrl.pathname = `/marketing${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(marketingUrl);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|mp4|pdf)$).*)",
  ],
};
