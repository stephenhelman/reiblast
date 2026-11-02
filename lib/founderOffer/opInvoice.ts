import type { PrismaClient } from "@prisma/client";
import { markSetupFeePaid } from "@/lib/billing/setupFee";
import type { ProcessResult } from "@/lib/billing/events/stageChanged";
import { customDataStringField } from "@/lib/billing/events/payloadFields";
import { countSlotsTaken, dbNow, FOUNDER_SLOTS_TOTAL } from "./slots";

/** OP Web Studio → HQ invoice webhook (POST /api/webhooks/op/invoice). One route, dispatched on (intent, event). */
export const OP_INVOICE_SOURCE = "op_invoice";
export const SETUP_FEE_AMOUNT = 97;

export type OpInvoice = {
  event: "invoice_sent" | "invoice_paid";
  intent: "setup_fee" | "founders_offer" | "other";
  invoiceId: string | null;
  invoiceUrl: string | null;
  status: string | null;
  amount: number | null;
  amountDue: number | null;
  studioContactId: string | null;
  hqContactId: string;
  productIds: string | null;
};

const FIELDS = ["event", "intent", "invoiceId", "invoiceUrl", "status", "amount", "amountDue", "studioContactId", "hqContactId", "productIds"] as const;

/** GhlEvent.externalId for the route: `${event}:${invoiceId}`, or null when either is missing. */
export function opInvoiceExternalId(body: Record<string, unknown>): string | null {
  const event = customDataStringField(body, "event");
  const invoiceId = customDataStringField(body, "invoiceId");
  return event && invoiceId ? `${event}:${invoiceId}` : null;
}

const isHttps = (u: string) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
const num = (v: string | null): number | null => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Empty string = null; any value containing "{{" (an unrendered GHL merge tag) rejects the whole payload. */
export function parseOpInvoice(payload: unknown): { ok: true; value: OpInvoice } | { ok: false; reason: "bad_payload" | "unrendered_tag" } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { ok: false, reason: "bad_payload" };
  const o = payload as Record<string, unknown>;
  const raw: Record<string, string | null> = {};
  for (const k of FIELDS) {
    const v = customDataStringField(o, k);
    if (v?.includes("{{")) return { ok: false, reason: "unrendered_tag" };
    raw[k] = v ?? null;
  }
  const { event, intent } = raw;
  if (event !== "invoice_sent" && event !== "invoice_paid") return { ok: false, reason: "bad_payload" };
  if (intent !== "setup_fee" && intent !== "founders_offer" && intent !== "other") return { ok: false, reason: "bad_payload" };
  if (!raw.hqContactId) return { ok: false, reason: "bad_payload" };
  return {
    ok: true,
    value: { event, intent, invoiceId: raw.invoiceId, invoiceUrl: raw.invoiceUrl, status: raw.status, amount: num(raw.amount), amountDue: num(raw.amountDue), studioContactId: raw.studioContactId, hqContactId: raw.hqContactId, productIds: raw.productIds },
  };
}

type Db = PrismaClient;
export type OpResult = { result: ProcessResult; reason: string };
/** Reasons that mean the event did what it should; anything else is stored in GhlEvent.lastError as a note for ops. */
const OK_REASONS = new Set(["invoice_recorded", "paid", "reinstated", "setup_fee_paid", "recorded"]);

const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

async function foundersInvoiceSent(db: Db, accountId: string, inv: OpInvoice): Promise<string> {
  if (!inv.invoiceId || !inv.invoiceUrl || !isHttps(inv.invoiceUrl)) return "bad_payload";
  const claim = await db.founderClaim.findUnique({ where: { ghlAccountId: accountId } });
  if (!claim || claim.status !== "PENDING_PAYMENT") return "no_open_claim";
  if (claim.invoiceId && claim.invoiceId !== inv.invoiceId) {
    console.error(`[op-invoice] invoice_conflict claim=${claim.id}`);
    return "invoice_conflict";
  }
  if (inv.studioContactId && !claim.studioContactId) await db.founderClaim.updateMany({ where: { id: claim.id, studioContactId: null }, data: { studioContactId: inv.studioContactId } });
  if (claim.invoiceId === inv.invoiceId) return "already_processed";
  try {
    // Conditional write: if a concurrent delivery set an invoice first, count is 0 and we re-read to classify.
    const n = (await db.founderClaim.updateMany({ where: { id: claim.id, invoiceId: null }, data: { invoiceId: inv.invoiceId, invoiceUrl: inv.invoiceUrl } })).count;
    if (n === 1) return "invoice_recorded";
  } catch (e) {
    if (!isUnique(e)) throw e;
    console.error(`[op-invoice] invoice_conflict (invoice on another claim) claim=${claim.id}`);
    return "invoice_conflict";
  }
  const now = await db.founderClaim.findUnique({ where: { id: claim.id }, select: { invoiceId: true } });
  return now?.invoiceId === inv.invoiceId ? "already_processed" : "invoice_conflict";
}

async function foundersInvoicePaid(db: Db, accountId: string, inv: OpInvoice): Promise<string> {
  if (!inv.invoiceId) return "bad_payload";
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext('founder_claim'))) AS t`;
    const claim = await tx.founderClaim.findUnique({ where: { ghlAccountId: accountId } });
    if (!claim) return "no_open_claim";
    if (claim.status === "PAID") return claim.invoiceId === inv.invoiceId ? "already_processed" : "invoice_mismatch";
    if (claim.status === "FREE_WINNER") return "no_open_claim";
    if (claim.invoiceId !== inv.invoiceId) return "invoice_mismatch";
    const now = await dbNow(tx);
    if (claim.status === "RELEASED") {
      // Paid after the hold lapsed: honour it only if a slot is still free, otherwise someone must refund by hand.
      if ((await countSlotsTaken(tx, now)) >= FOUNDER_SLOTS_TOTAL) {
        console.error(`[op-invoice] manual_refund_needed claim=${claim.id}`);
        return "manual_refund_needed";
      }
      await tx.founderClaim.update({ where: { id: claim.id }, data: { status: "PAID", paidAt: now, releasedAt: null } });
      return "reinstated";
    }
    await tx.founderClaim.update({ where: { id: claim.id }, data: { status: "PAID", paidAt: now } });
    return "paid";
  }, { timeout: 15_000, maxWait: 5_000 });
}

/** Dispatch one parsed invoice. Never writes for an unknown account or "other". */
export async function applyOpInvoice(db: Db, inv: OpInvoice): Promise<string> {
  if (inv.intent === "other") return "ignored";
  const account = await db.ghlAccount.findUnique({ where: { contactId: inv.hqContactId }, select: { id: true } });
  if (!account) return "no_account";
  if (inv.intent === "founders_offer") return inv.event === "invoice_sent" ? foundersInvoiceSent(db, account.id, inv) : foundersInvoicePaid(db, account.id, inv);
  // setup_fee
  if (inv.event === "invoice_sent") return "recorded"; // the GhlEvent row is the log
  if (inv.amount == null || inv.amount < SETUP_FEE_AMOUNT) return "amount_mismatch";
  await markSetupFeePaid(db, account.id);
  return "setup_fee_paid";
}

/** Process one recorded op_invoice event. Never throws: failures increment attempts and store lastError (the replay job retries them). */
export async function runOpInvoiceEvent(eventId: string, opts: { db: Db }): Promise<OpResult> {
  const { db } = opts;
  const event = await db.ghlEvent.findUnique({ where: { id: eventId } });
  if (!event) return { result: "not_found", reason: "not_found" };
  if (event.processedAt) return { result: "already_processed", reason: "already_processed" };
  const done = (reason: string) => db.ghlEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: OK_REASONS.has(reason) ? null : reason } });
  try {
    const parsed = parseOpInvoice(event.payload);
    if (!parsed.ok) {
      await done(parsed.reason);
      return { result: "processed", reason: parsed.reason };
    }
    const reason = await applyOpInvoice(db, parsed.value);
    await done(reason);
    return { result: "processed", reason };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error("[op-invoice] processing failed:", message);
    await db.ghlEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: message } });
    return { result: "failed", reason: "processing_failed" };
  }
}

export const processOpInvoiceEvent = async (eventId: string, opts: { db: Db }): Promise<ProcessResult> => (await runOpInvoiceEvent(eventId, opts)).result;
