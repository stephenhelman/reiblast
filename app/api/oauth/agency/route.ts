/**
 * GHL Agency OAuth callback.
 *
 * GHL redirects here after the agency-level app installation with a one-time
 * authorization code. We exchange it for an access_token + refresh_token and
 * store both in GhlToken under the sentinel key "company". All subsequent
 * location token requests use getCompanyToken() which reads from that record
 * and refreshes via refresh_token when the access_token expires.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  console.log("[GHL Agency OAuth] Callback received:", params);

  const code = params.code;
  if (!code) {
    console.error("[GHL Agency OAuth] No code in callback");
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const tokenRes = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GHL_PLATFORM_CLIENT_ID!,
      client_secret: process.env.GHL_PLATFORM_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.GHL_PLATFORM_REDIRECT_URI!,
    }),
  });

  const raw = await tokenRes.text();
  console.log("[GHL Agency OAuth] Token exchange response:", raw);

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed", details: raw }, { status: 500 });
  }

  const data = JSON.parse(raw);
  const { access_token, refresh_token, expires_in } = data;
  const expiresAt = new Date(Date.now() + (expires_in ?? 86400) * 1000);

  await prisma.ghlToken.upsert({
    where: { locationId: "company" },
    update: { accessToken: access_token, refreshToken: refresh_token, expiresAt },
    create: { locationId: "company", accessToken: access_token, refreshToken: refresh_token, expiresAt },
  });

  console.log("[GHL Agency OAuth] Company token stored. userType:", data.userType);
  return NextResponse.json({ ok: true, userType: data.userType });
}
