import { NextRequest, NextResponse } from "next/server";
import { createHQContact, moveOpportunityToStage } from "@/lib/ghl";
import { prisma } from "@/lib/prisma";
import type { ChatLeadRequest } from "@/lib/chat/types";

export async function POST(req: NextRequest) {
  const body: ChatLeadRequest = await req.json();
  const { lead, smsConsent, consentedAt } = body;

  // The capture flow requires both phone and email before it reaches @capture's
  // final step, so both are expected here.
  if (!lead?.email || !lead?.phone) {
    return NextResponse.json(
      { success: false, error: "Lead requires both email and phone" },
      { status: 400 },
    );
  }

  const name = lead.name?.trim() || "Chat Widget Lead";
  const email = lead.email.trim();
  const phone = lead.phone.trim();

  // System of record: GHL. This write is unchanged from the existing,
  // confirmed-working pipeline wiring.
  try {
    const { contactId } = await createHQContact(name, email, phone);

    const pipelineId = process.env.GHL_SALES_PIPELINE_ID;
    const stageId = process.env.GHL_STAGE_SALES_NEW_LEAD;
    if (pipelineId && stageId) {
      await moveOpportunityToStage(contactId, pipelineId, stageId, name);
    } else {
      console.error("[chat/lead] Missing GHL_SALES_PIPELINE_ID or GHL_STAGE_SALES_NEW_LEAD");
    }
  } catch (err) {
    console.error("[chat/lead] Failed to log lead to GHL:", err);
    return NextResponse.json(
      { success: false, error: "Failed to log lead" },
      { status: 500 },
    );
  }

  // Secondary sink: local Lead table. Best-effort — a failure here must not
  // lose the GHL lead that already succeeded above, so it's caught and logged
  // rather than surfaced as a failed response to the widget.
  try {
    const consented = smsConsent === true;
    await prisma.lead.create({
      data: {
        name: lead.name?.trim() || null,
        phone,
        email,
        smsConsent: consented,
        consentedAt: consented ? (consentedAt ? new Date(consentedAt) : new Date()) : null,
        source: "chat_widget",
      },
    });
  } catch (err) {
    console.error("[chat/lead] Failed to persist Lead row (GHL write already succeeded):", err);
  }

  return NextResponse.json({ success: true });
}
