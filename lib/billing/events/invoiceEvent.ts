import type { PrismaClient } from "@prisma/client";
import { fetchInvoice, invoiceExpiry, type InvoiceInfo } from "../invoices";
import { applyDunning, dunningMode, type ApplyDeps } from "../state/apply";
import type { ProcessResult } from "./stageChanged";

export type InvoiceDeps = ApplyDeps & { fetchInvoice?: (id: string) => Promise<InvoiceInfo | null> };

/**
 * Turn one fetched invoice into an invoice_expired engine event when it is an expired/void-unpaid CORE recovery invoice.
 * Shared by the invoice webhook and the nightly sweep's backstop. Returns why it did (not) act.
 */
export async function applyInvoice(db: PrismaClient, inv: InvoiceInfo, opts: { deps?: InvoiceDeps } = {}): Promise<{ acted: boolean; why: string }> {
  const now = (opts.deps?.now ?? (() => new Date()))();
  if (!inv.isCore) return { acted: false, why: `not a core invoice (source ${inv.source ?? "unknown"})` };
  const exp = invoiceExpiry(inv, now);
  if (!exp.expired) return { acted: false, why: exp.why };
  if (!inv.contactId) return { acted: false, why: "invoice has no contact" };
  const account = await db.ghlAccount.findFirst({ where: { contactId: inv.contactId, accountType: "member" }, select: { id: true } });
  if (!account) return { acted: false, why: "no member account for the invoice's contact" };
  // Coverage (now < coreCoveredUntil) is honored inside decide(): the decision is recorded as "covered, ignored".
  const r = await applyDunning(db, { ghlAccountId: account.id, trigger: `invoice:${inv.id}`, event: { kind: "invoice_expired", invoiceId: inv.id }, eventAt: now }, { mode: dunningMode(opts.deps?.env), deps: opts.deps });
  return { acted: r.status === "recorded", why: `${exp.why} → ${r.status}${r.status === "recorded" ? `: ${r.decision.reason}` : r.status === "skipped" ? ` (${r.why})` : ""}` };
}

/** Process one recorded invoice event: fetch the invoice by id (the webhook payload lacks what we need), then apply. Never throws. */
export async function processInvoiceEvent(eventId: string, opts: { db: PrismaClient; deps?: InvoiceDeps }): Promise<ProcessResult> {
  const { db } = opts;
  const event = await db.ghlEvent.findUnique({ where: { id: eventId } });
  if (!event) return "not_found";
  if (event.processedAt) return "already_processed";
  try {
    if (!event.externalId || !/^[A-Za-z0-9]{10,64}$/.test(event.externalId)) {
      await db.ghlEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: "ignored: no valid invoiceId" } });
      return "processed";
    }
    const inv = await (opts.deps?.fetchInvoice ?? fetchInvoice)(event.externalId);
    if (!inv) throw new Error("invoice could not be read");
    const r = await applyInvoice(db, inv, { deps: opts.deps });
    await db.ghlEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: r.acted ? null : `no action: ${r.why}`.slice(0, 500) } });
    return "processed";
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error("[invoice-event] processing failed:", message);
    await db.ghlEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: message } });
    return "failed";
  }
}
