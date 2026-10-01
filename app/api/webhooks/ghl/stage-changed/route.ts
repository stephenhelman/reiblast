import { NextRequest } from "next/server";
import { handleEventRoute } from "@/lib/billing/events/route";
import { processStageChanged } from "@/lib/billing/events/stageChanged";
import { customDataStringField } from "@/lib/billing/events/payloadFields";

// GHL "Pipeline Stage Changed" workflow → server (docs/oct1-release.md, docs/ghl-workflows.md). GHL's standard webhook
// action posts its own default shape; our fields are read from customData first, falling back to a flat top-level
// field (for manual/curl testing): customData.contactId / customData.pipeline / customData.stage, and optionally
// customData.secret as an auth fallback when a custom header isn't configurable on the workflow action.
// onboarding → GhlAccount.onboardingStage (display only). active_client → a dunning-engine command; stage "paused_confirm"
// (sent by the Paused workflow after its 15-minute wait) confirms a pause. In shadow mode only decisions are recorded.
export async function POST(req: NextRequest) {
  return handleEventRoute(req, {
    label: "stage-changed",
    source: "stage_change",
    externalId: (b) => customDataStringField(b, "contactId") ?? null,
    process: (id, db) => processStageChanged(id, { db }),
  });
}
