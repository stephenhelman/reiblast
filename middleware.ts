import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToolsSession } from "@/lib/toolsSession";
import { TOOLS_SESSION_COOKIE } from "@/lib/constants";

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

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
      const session = token ? await verifyToolsSession(token) : null;

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
  const marketingUrl = request.nextUrl.clone();
  marketingUrl.pathname = `/marketing${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(marketingUrl);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|mp4|pdf)$).*)",
  ],
};
