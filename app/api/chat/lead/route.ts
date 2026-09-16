import { NextRequest, NextResponse } from "next/server";
import { createHQContact, moveOpportunityToStage } from "@/lib/ghl";
import type { ChatLeadRequest } from "@/lib/chat/types";

// GHL is the only sink for chat-widget leads. A local Lead table was tried
// and reverted (2026-09-15) — it'll come back once the DB's migration-history
// drift gets a proper reconciliation pass, not layered onto it ad hoc.
export async function POST(req: NextRequest) {
  const body: ChatLeadRequest = await req.json();
  const { lead } = body;

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

  return NextResponse.json({ success: true });
}
