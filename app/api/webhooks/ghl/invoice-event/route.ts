import { NextRequest } from "next/server";
import { handleEventRoute } from "@/lib/billing/events/route";
import { processInvoiceEvent } from "@/lib/billing/events/invoiceEvent";

// GHL invoice workflow → server (docs/ghl-workflows.md). Body: { invoiceId }. The invoice is fetched by id; only an expired or
// void-unpaid CORE recovery invoice becomes an invoice_expired engine event.
export async function POST(req: NextRequest) {
  return handleEventRoute(req, {
    label: "invoice-event",
    source: "invoice",
    externalId: (b) => {
      const v = b.invoiceId ?? b.invoice_id ?? (b.customData as Record<string, unknown> | undefined)?.invoiceId;
      return typeof v === "string" && v.trim() ? v.trim() : null;
    },
    process: (id, db) => processInvoiceEvent(id, { db }),
  });
}
