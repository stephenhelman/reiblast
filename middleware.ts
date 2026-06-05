import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  const isToolsHost =
    hostname.startsWith("tools.") ||
    hostname === "tools.reiblast.app" ||
    hostname === "localhost:3001";

  if (isToolsHost) {
    // Widget routes — no auth, rewrite to /tools/widget/*
    if (pathname.startsWith("/widget")) {
      return NextResponse.rewrite(
        new URL(`/tools/widget${pathname.replace("/widget", "")}`, request.url),
      );
    }

    // All other tool routes — auth handled via token query param on each page
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
