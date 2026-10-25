import { NextRequest, NextResponse } from "next/server";
import { checkSecret, logInternalError } from "@/lib/billing/reason";
import { defaultPromoDb } from "@/lib/promo/post";
import { findHandler } from "@/lib/promo/handlers";

// Reusable GHL -> server promo receiver. GHL only runs the clock; the server decides what to post and where. Server-to-server, so
// no guardRegion. Always HTTP 200 with a JSON `reason` (contract rule 6). Auth: x-reiblast-promo-secret vs GHL_PROMO_SECRET.
// Body: { promo, event, dryRun? }. dryRun === "true" returns the built payload and sends/writes nothing. Never log webhook URLs.

const reply = (body: { reason: string; [k: string]: unknown }) => {
  console.log(`[ghl-promo] reason=${body.reason}`);
  return NextResponse.json(body);
};

export async function POST(req: NextRequest) {
  try {
    const auth = checkSecret(req.headers.get("x-reiblast-promo-secret"), "GHL_PROMO_SECRET");
    if (auth === "misconfigured") {
      console.error("[ghl-promo] missing required env var(s): GHL_PROMO_SECRET");
      return reply({ reason: "server_misconfigured" });
    }
    if (auth === "missing") return reply({ reason: "auth_missing" });
    if (auth === "failed") return reply({ reason: "auth_failed" });

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return reply({ reason: "bad_json" });
    }

    const handler = findHandler(body.promo, body.event);
    if (!handler) return reply({ reason: "unknown_event" });

    const out = await handler({ now: new Date(), dryRun: body.dryRun === "true", db: defaultPromoDb() });
    return reply(out);
  } catch (err) {
    logInternalError("ghl-promo", err);
    return reply({ reason: "internal_error" });
  }
}
