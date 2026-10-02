import { NextRequest } from "next/server";
import { handleEventRoute } from "@/lib/billing/events/route";
import { processInvoiceEvent } from "@/lib/billing/events/invoiceEvent";
import { customDataStringField } from "@/lib/billing/events/payloadFields";

// GHL invoice workflow → server (docs/oct1-release.md, docs/ghl-workflows.md). GHL's standard webhook action posts its
// own default shape; invoiceId is read from customData.invoiceId first, falling back to a flat top-level invoiceId/
// invoice_id (for manual/curl testing), and optionally customData.secret as an auth fallback. The invoice is fetched
// by id; only an expired or void-unpaid CORE recovery invoice becomes an invoice_expired engine event.
export async function POST(req: NextRequest) {
  return handleEventRoute(req, {
    label: "invoice-event",
    source: "invoice",
    externalId: (b) => customDataStringField(b, "invoiceId") ?? customDataStringField(b, "invoice_id") ?? null,
    process: (id, db) => processInvoiceEvent(id, { db }),
  });
}
