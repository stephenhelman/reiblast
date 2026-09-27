import { NextRequest } from "next/server";
import { handleEventRoute } from "@/lib/billing/events/route";
import { processStageChanged } from "@/lib/billing/events/stageChanged";

// GHL "Pipeline Stage Changed" workflow → server (docs/ghl-workflows.md). Body: { contactId, pipeline, stage }.
// onboarding → GhlAccount.onboardingStage (display only). active_client → a dunning-engine command; stage "paused_confirm"
// (sent by the Paused workflow after its 15-minute wait) confirms a pause. In shadow mode only decisions are recorded.
export async function POST(req: NextRequest) {
  return handleEventRoute(req, {
    label: "stage-changed",
    source: "stage_change",
    externalId: (b) => (typeof b.contactId === "string" && b.contactId.trim() ? b.contactId.trim() : null),
    process: (id, db) => processStageChanged(id, { db }),
  });
}
