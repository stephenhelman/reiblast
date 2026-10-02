import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import { unpauseLocation } from "@/lib/ghl/client";
import { moveOpportunityToStage, hasOpportunityInPipeline } from "@/lib/ghl";

export async function POST(req: NextRequest) {
  if (!verifyWebhook(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email as string) || "";

  if (!email) {
    console.log("[Active webhook] No email, ignoring");
    return NextResponse.json({ received: true });
  }

  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.log("[Active webhook] No user for email, ignoring:", email);
    return NextResponse.json({ received: true });
  }

  const hadWarnings = user.warningCount > 0;
  const wasSuspended = user.status === "suspended";

  if (hadWarnings) {
    await prisma.user.update({
      where: { id: user.id },
      data: { warningCount: 0 },
    });
  }

  if (wasSuspended && user.ghlLocationId) {
    await unpauseLocation(user.ghlLocationId);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { status: "active" },
  });

  // Repointed at the Clients pipeline's "Active Member" stage identity (lib/billing/stages.ts) — this route
  // previously made no stage move at all. See docs/oct1-release.md item 6 for the env vars this needs.
  //
  // Only moves a card that already exists in the Clients pipeline. Never creates a brand-new Clients-pipeline
  // opportunity here: a member with no Clients card yet (never handed off via A2P Approved) has nothing to
  // reactivate into "Active Member" — resuming a paused ONBOARDING member back into onboarding progress is a
  // manual action for Oct 1, not automated (docs/oct1-release.md item 5).
  if (user.ghlContactId) {
    if (process.env.GHL_CLIENTS_PIPELINE_ID && process.env.GHL_CLIENTS_STAGE_ACTIVE) {
      const hasClientsCard = await hasOpportunityInPipeline(user.ghlContactId, process.env.GHL_CLIENTS_PIPELINE_ID);
      if (hasClientsCard) {
        await moveOpportunityToStage(user.ghlContactId, process.env.GHL_CLIENTS_PIPELINE_ID, process.env.GHL_CLIENTS_STAGE_ACTIVE, user.name || email);
      } else {
        console.log("[Active webhook] No Clients-pipeline card for this contact — nothing to move (manual resume for onboarding-paused members)");
      }
    } else {
      console.error("[Active webhook] GHL_CLIENTS_PIPELINE_ID / GHL_CLIENTS_STAGE_ACTIVE not configured — cannot move opportunity");
    }
  }

  return NextResponse.json({ action: "activated", hadWarnings, wasSuspended });
}
