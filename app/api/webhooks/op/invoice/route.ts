import { NextRequest } from "next/server";
import { handleEventRoute } from "@/lib/billing/events/route";
import { OP_INVOICE_SOURCE, opInvoiceExternalId, runOpInvoiceEvent } from "@/lib/founderOffer/opInvoice";

// OP Web Studio → HQ invoice receiver (founder invoice_sent / invoice_paid, setup-fee invoice_sent / invoice_paid). Server-to-server, so
// no guardRegion. Auth: x-reiblast-op-secret vs OP_WEBHOOK_SECRET (header only). Recorded as GhlEvent source "op_invoice" first, then
// processed; always HTTP 200 with a `reason` (contract rule 6). Body: lib/founderOffer/opInvoice.ts.
export async function POST(req: NextRequest) {
  return handleEventRoute(req, {
    label: "op-invoice",
    source: OP_INVOICE_SOURCE,
    externalId: opInvoiceExternalId,
    process: (id, db) => runOpInvoiceEvent(id, { db: db as never }),
    auth: { header: "x-reiblast-op-secret", envName: "OP_WEBHOOK_SECRET" },
  });
}
