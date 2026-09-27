/** Read-only GHL invoice access (HQ key; invoices read scope verified). Core recovery invoices have source "payments_subscription". */
export type InvoiceInfo = { id: string; status: string; contactId: string | null; dueDate: Date | null; amountDue: number; source: string | null; isCore: boolean };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function parseInvoice(input: unknown): InvoiceInfo | null {
  const r = isObj(input) && isObj(input.data) ? input.data : input;
  if (!isObj(r)) return null;
  const id = str(r._id);
  const status = str(r.status);
  if (!id || !status) return null;
  const due = str(r.dueDate);
  const dueDate = due && !Number.isNaN(Date.parse(due)) ? new Date(due) : null;
  const amountDue = typeof r.amountDue === "number" ? r.amountDue : Number(r.amountDue ?? 0) || 0;
  const source = str(r.source);
  return { id, status, contactId: isObj(r.contactDetails) ? str(r.contactDetails.id) : null, dueDate, amountDue, source, isCore: source === "payments_subscription" };
}

/**
 * GHL has no native "expired" invoice status, so it is derived: voided, or still open (sent / partially paid) past its due date
 * with an amount due. Paid and draft invoices are never expired.
 */
export function invoiceExpiry(inv: InvoiceInfo, now: Date): { expired: boolean; why: string } {
  if (inv.status === "void") return { expired: true, why: "invoice voided unpaid" };
  if ((inv.status === "sent" || inv.status === "partially_paid" || inv.status === "payment_processing") && inv.dueDate && inv.dueDate.getTime() < now.getTime() && inv.amountDue > 0) {
    return { expired: true, why: `invoice past due (${inv.dueDate.toISOString().slice(0, 10)}) with ${inv.amountDue} unpaid` };
  }
  return { expired: false, why: `not expired (status ${inv.status}${inv.dueDate ? `, due ${inv.dueDate.toISOString().slice(0, 10)}` : ""})` };
}

async function get(path: string): Promise<unknown> {
  const token = process.env.GHL_HQ_API_KEY;
  const locationId = process.env.GHL_HQ_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_HQ_API_KEY / GHL_HQ_LOCATION_ID not set");
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://services.leadconnectorhq.com${path}${sep}altId=${encodeURIComponent(locationId)}&altType=location`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GHL invoice read failed: HTTP ${res.status}`);
  return res.json();
}

export async function fetchInvoice(invoiceId: string): Promise<InvoiceInfo | null> {
  if (!/^[A-Za-z0-9]{10,64}$/.test(invoiceId)) throw new Error("invalid invoice id");
  return parseInvoice(await get(`/invoices/${invoiceId}`));
}

export async function listInvoicesPage(offset: number, limit = 100): Promise<InvoiceInfo[]> {
  const j = (await get(`/invoices/?limit=${limit}&offset=${offset}`)) as { invoices?: unknown[]; data?: unknown[] };
  return (j.invoices ?? j.data ?? []).map(parseInvoice).filter((x): x is InvoiceInfo => !!x);
}
