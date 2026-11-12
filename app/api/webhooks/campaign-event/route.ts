import { NextRequest, NextResponse } from "next/server";
import { getBillingDb } from "@/lib/billing/db";
import { checkSecret, logInternalError, missingEnvVars, type Reason } from "@/lib/billing/reason";
import { parseCampaignPayload, recordCampaignEvent, stepForEvent } from "@/lib/campaign/stats";

// Member sub-account workflows → campaign stats (GHL standard Webhook action; Custom Data carries the fields). Custom Data: locationId,
// event (entered | replied | errored | no_response), listType, listName, variant. Blank values are stored as "".
// Auth: ONE path — the x-campaign-secret header vs CAMPAIGN_EVENT_SECRET (checkSecret → secretMatches, timing-safe). There is no body-secret
// fallback. The secret is never logged or stored — nothing from the payload is stored.
// ALWAYS HTTP 200 with a `reason` (contract rule 6). The request path is: one indexed GhlAccount lookup + one atomic upsert. No GhlEvent row,
// no GHL calls, no aggregation (the campaign_snapshot job does the monthly roll-up). See lib/campaign/stats.ts.
const reply = (reason: Reason) => NextResponse.json({ received: reason === "accepted", reason });

export async function POST(req: NextRequest) {
  try {
    const auth = checkSecret(req.headers.get("x-campaign-secret"), "CAMPAIGN_EVENT_SECRET");
    if (auth === "misconfigured") {
      console.error("[campaign-event] missing required env var(s):", missingEnvVars(["CAMPAIGN_EVENT_SECRET"]).join(", "));
      return reply("server_misconfigured");
    }
    if (auth === "missing") {
      console.warn("[campaign-event] auth missing — ignoring");
      return reply("auth_missing");
    }
    if (auth === "failed") {
      console.warn("[campaign-event] auth failed — ignoring");
      return reply("auth_failed");
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.warn("[campaign-event] invalid JSON body — ignoring");
      return reply("bad_json");
    }

    const parsed = parseCampaignPayload(body);
    if (!parsed.ok) return reply(parsed.reason);

    const db = await getBillingDb();
    const account = await db.ghlAccount.findFirst({ where: { locationId: parsed.value.locationId, accountType: "member" }, select: { id: true } });
    if (!account) return reply("unknown_location");

    await recordCampaignEvent(db, parsed.value, stepForEvent(parsed.value.event, body), new Date());
    return reply("accepted");
  } catch (err) {
    logInternalError("campaign-event", err);
    return reply("internal_error");
  }
}
