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
        return NextResponse.rewrite(new URL("/tools/session-expired", request.url));
      }
    }

    return NextResponse.rewrite(
      new URL(`/tools${pathname === "/" ? "" : pathname}`, request.url),
    );
  }

  // Marketing site — all other hostnames
  return NextResponse.rewrite(
    new URL(`/marketing${pathname === "/" ? "" : pathname}`, request.url),
  );
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|mp4|pdf)$).*)",
  ],
};
