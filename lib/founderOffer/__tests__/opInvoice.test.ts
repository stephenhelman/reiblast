import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { applyOpInvoice, opInvoiceExternalId, parseOpInvoice, runOpInvoiceEvent, type OpInvoice } from "../opInvoice";

type Row = Record<string, any>;
const NOW = new Date("2026-10-29T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

function makeDb(opts: { claims?: Row[]; events?: Row[] } = {}) {
  const accounts: Row[] = [{ id: "A1", contactId: "HQ1", setupFeeStatus: "PENDING" }, { id: "A2", contactId: "HQ2", setupFeeStatus: "PENDING" }];
  const claims: Row[] = (opts.claims ?? []).map((c) => ({ studioContactId: null, invoiceId: null, invoiceUrl: null, ...c }));
  const events: Row[] = opts.events ?? [];
  const match = (r: Row, w: Row = {}) => Object.entries(w).every(([k, c]) => (c && typeof c === "object" && "in" in c ? c.in.includes(r[k]) : r[k] === c));
  const db: any = {
    accounts, claims, events,
    $queryRaw: async (s: TemplateStringsArray) => (s[0].includes("advisory") ? [{ locked: 1 }] : [{ now: NOW }]),
    $transaction: async (fn: any) => fn(db),
    ghlAccount: {
      findUnique: async ({ where }: Row) => accounts.find((a) => a.contactId === where.contactId || a.id === where.id) ?? null,
      updateMany: async ({ where, data }: Row) => { const h = accounts.filter((a) => match(a, where)); h.forEach((a) => Object.assign(a, data)); return { count: h.length }; },
    },
    founderClaim: {
      findUnique: async ({ where }: Row) => claims.find((c) => (where.ghlAccountId ? c.ghlAccountId === where.ghlAccountId : c.id === where.id)) ?? null,
      findMany: async ({ where }: Row) => claims.filter((c) => match(c, where)),
      updateMany: async ({ where, data }: Row) => {
        const h = claims.filter((c) => match(c, where));
        if (data.invoiceId && claims.some((c) => c.invoiceId === data.invoiceId && !h.includes(c))) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" });
        h.forEach((c) => Object.assign(c, data)); return { count: h.length };
      },
      update: async ({ where, data }: Row) => { const c = claims.find((x) => x.id === where.id)!; Object.assign(c, data); return c; },
    },
    ghlEvent: {
      findUnique: async ({ where }: Row) => events.find((e) => e.id === where.id) ?? null,
      update: async ({ where, data }: Row) => { const e = events.find((x) => x.id === where.id)!; for (const [k, v] of Object.entries<any>(data)) e[k] = v && typeof v === "object" && "increment" in v ? (e[k] ?? 0) + v.increment : v; return e; },
    },
  };
  return db;
}
const pending = (over: Row = {}): Row => ({ id: "FC1", ghlAccountId: "A1", status: "PENDING_PAYMENT", isFirst: false, claimedAt: hoursAgo(2), ...over });
const inv = (over: Partial<OpInvoice> = {}): OpInvoice => ({ event: "invoice_sent", intent: "founders_offer", invoiceId: "inv1", invoiceUrl: "https://pay.example/inv1", status: "sent", amount: 100, amountDue: 100, studioContactId: "ST1", hqContactId: "HQ1", productIds: null, ...over });

describe("parseOpInvoice / externalId", () => {
  const body = { event: "invoice_sent", intent: "founders_offer", invoiceId: "inv1", invoiceUrl: "https://x", status: "", amount: "100", amountDue: "100", studioContactId: "ST1", hqContactId: "HQ1", productIds: "" };
  it("empty = null, numbers parsed, accepts the flat body", () => {
    const p: any = parseOpInvoice(body);
    expect(p.ok).toBe(true);
    expect(p.value).toMatchObject({ status: null, productIds: null, amount: 100, amountDue: 100 });
  });
  it("any value containing '{{' rejects the payload", () => {
    expect(parseOpInvoice({ ...body, studioContactId: "{{contact.id}}" })).toEqual({ ok: false, reason: "unrendered_tag" });
  });
  it("bad event / intent / missing hqContactId are bad_payload", () => {
    for (const o of [{ event: "x" }, { intent: "y" }, { hqContactId: "" }]) expect(parseOpInvoice({ ...body, ...o })).toEqual({ ok: false, reason: "bad_payload" });
  });
  it("externalId is `${event}:${invoiceId}`", () => {
    expect(opInvoiceExternalId(body)).toBe("invoice_sent:inv1");
    expect(opInvoiceExternalId({ event: "invoice_sent" })).toBeNull();
  });
});

describe("founders_offer + invoice_sent (launch-critical)", () => {
  it("records invoiceId, invoiceUrl and studioContactId on a PENDING_PAYMENT claim", async () => {
    const db = makeDb({ claims: [pending()] });
    expect(await applyOpInvoice(db, inv())).toBe("invoice_recorded");
    expect(db.claims[0]).toMatchObject({ invoiceId: "inv1", invoiceUrl: "https://pay.example/inv1", studioContactId: "ST1", status: "PENDING_PAYMENT" });
  });
  it("a repeat of the same invoice is already_processed and changes nothing", async () => {
    const db = makeDb({ claims: [pending()] });
    await applyOpInvoice(db, inv());
    const before = JSON.stringify(db.claims);
    expect(await applyOpInvoice(db, inv())).toBe("already_processed");
    expect(JSON.stringify(db.claims)).toBe(before);
  });
  it("a different invoice id is invoice_conflict with no overwrite (not even studioContactId)", async () => {
    const db = makeDb({ claims: [pending({ invoiceId: "inv1", invoiceUrl: "https://pay.example/inv1" })] });
    expect(await applyOpInvoice(db, inv({ invoiceId: "inv2", invoiceUrl: "https://pay.example/inv2" }))).toBe("invoice_conflict");
    expect(db.claims[0]).toMatchObject({ invoiceId: "inv1", studioContactId: null });
  });
  it("the same invoice id already on ANOTHER claim is invoice_conflict (unique violation)", async () => {
    const db = makeDb({ claims: [pending(), pending({ id: "FC2", ghlAccountId: "A2", invoiceId: "inv1" })] });
    expect(await applyOpInvoice(db, inv())).toBe("invoice_conflict");
    expect(db.claims[0].invoiceId).toBeNull();
  });
  it("keeps an existing studioContactId", async () => {
    const db = makeDb({ claims: [pending({ studioContactId: "KEEP" })] });
    await applyOpInvoice(db, inv());
    expect(db.claims[0].studioContactId).toBe("KEEP");
  });
  it("no claim, or a claim that is not PENDING_PAYMENT → no_open_claim; unknown contact → no_account", async () => {
    expect(await applyOpInvoice(makeDb(), inv())).toBe("no_open_claim");
    for (const status of ["FREE_WINNER", "PAID", "RELEASED"]) expect(await applyOpInvoice(makeDb({ claims: [pending({ status })] }), inv())).toBe("no_open_claim");
    expect(await applyOpInvoice(makeDb({ claims: [pending()] }), inv({ hqContactId: "NOPE" }))).toBe("no_account");
  });
  it("needs a non-empty https invoiceUrl and an invoiceId", async () => {
    for (const o of [{ invoiceUrl: "http://pay.example/x" }, { invoiceUrl: null }, { invoiceId: null }]) {
      const db = makeDb({ claims: [pending()] });
      expect(await applyOpInvoice(db, inv(o))).toBe("bad_payload");
      expect(db.claims[0].invoiceId).toBeNull();
    }
  });
});

describe("founders_offer + invoice_paid", () => {
  const paid = (o: Partial<OpInvoice> = {}) => inv({ event: "invoice_paid", status: "paid", ...o });
  it("PENDING_PAYMENT with a matching invoice → PAID + paidAt; repeat is already_processed", async () => {
    const db = makeDb({ claims: [pending({ invoiceId: "inv1" })] });
    expect(await applyOpInvoice(db, paid())).toBe("paid");
    expect(db.claims[0]).toMatchObject({ status: "PAID", paidAt: NOW });
    expect(await applyOpInvoice(db, paid())).toBe("already_processed");
  });
  it("must match the claim's invoiceId (including a claim with none yet)", async () => {
    for (const invoiceId of ["other", null]) {
      const db = makeDb({ claims: [pending({ invoiceId })] });
      expect(await applyOpInvoice(db, paid())).toBe("invoice_mismatch");
      expect(db.claims[0].status).toBe("PENDING_PAYMENT");
    }
  });
  it("RELEASED + payment: reinstated when a slot is open, else manual_refund_needed with no write", async () => {
    const released = pending({ status: "RELEASED", invoiceId: "inv1", releasedAt: hoursAgo(1), claimedAt: hoursAgo(30) });
    const open = makeDb({ claims: [released] });
    expect(await applyOpInvoice(open, paid())).toBe("reinstated");
    expect(open.claims[0]).toMatchObject({ status: "PAID", releasedAt: null });
    const full = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, ghlAccountId: `X${i}`, status: "PAID", claimedAt: hoursAgo(5) }));
    const sold = makeDb({ claims: [released, ...full] });
    expect(await applyOpInvoice(sold, paid())).toBe("manual_refund_needed");
    expect(sold.claims[0].status).toBe("RELEASED");
  });
});

describe("setup_fee + other", () => {
  it("invoice_sent only records (no account write)", async () => {
    const db = makeDb();
    expect(await applyOpInvoice(db, inv({ intent: "setup_fee" }))).toBe("recorded");
    expect(db.accounts[0].setupFeeStatus).toBe("PENDING");
  });
  it("invoice_paid marks PAID at 97 or more; under 97 or missing is amount_mismatch", async () => {
    const p = (amount: number | null) => inv({ intent: "setup_fee", event: "invoice_paid", amount });
    const db = makeDb();
    expect(await applyOpInvoice(db, p(96.99))).toBe("amount_mismatch");
    expect(await applyOpInvoice(db, p(null))).toBe("amount_mismatch");
    expect(db.accounts[0].setupFeeStatus).toBe("PENDING");
    expect(await applyOpInvoice(db, p(97))).toBe("setup_fee_paid");
    expect(db.accounts[0].setupFeeStatus).toBe("PAID");
  });
  it("other is ignored, even for an unknown contact", async () => {
    expect(await applyOpInvoice(makeDb(), inv({ intent: "other", hqContactId: "NOPE" }))).toBe("ignored");
  });
});

describe("runOpInvoiceEvent", () => {
  const ev = (payload: Row): Row => ({ id: "E1", source: "op_invoice", payload, processedAt: null, attempts: 0, lastError: null });
  const body = { event: "invoice_sent", intent: "founders_offer", invoiceId: "inv1", invoiceUrl: "https://pay.example/inv1", studioContactId: "ST1", hqContactId: "HQ1" };
  it("marks the event processed with the reason as a note (null for success)", async () => {
    const db = makeDb({ claims: [pending()], events: [ev(body)] });
    expect(await runOpInvoiceEvent("E1", { db })).toEqual({ result: "processed", reason: "invoice_recorded" });
    expect(db.events[0]).toMatchObject({ lastError: null });
    expect(db.events[0].processedAt).toBeInstanceOf(Date);
    expect(await runOpInvoiceEvent("E1", { db })).toEqual({ result: "already_processed", reason: "already_processed" });
    const db2 = makeDb({ events: [ev(body)] });
    expect(await runOpInvoiceEvent("E1", { db: db2 })).toEqual({ result: "processed", reason: "no_open_claim" });
    expect(db2.events[0].lastError).toBe("no_open_claim");
  });
  it("a merge tag is recorded and rejected; a thrown error is failed with attempts+1 for replay", async () => {
    const bad = makeDb({ events: [ev({ ...body, invoiceId: "{{invoice.id}}" })] });
    expect(await runOpInvoiceEvent("E1", { db: bad })).toEqual({ result: "processed", reason: "unrendered_tag" });
    const boom = makeDb({ claims: [pending()], events: [ev(body)] });
    boom.founderClaim.findUnique = async () => { throw new Error("db down"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runOpInvoiceEvent("E1", { db: boom })).toEqual({ result: "failed", reason: "processing_failed" });
    expect(boom.events[0]).toMatchObject({ attempts: 1, lastError: "db down", processedAt: null });
  });
});

describe("registered for replay", () => {
  it("processGhlEvent routes source op_invoice to the processor", async () => {
    const { processGhlEvent } = await import("@/lib/billing/events/process");
    const db = makeDb({ claims: [pending()], events: [{ id: "E1", source: "op_invoice", processedAt: null, attempts: 0, payload: { event: "invoice_sent", intent: "founders_offer", invoiceId: "inv1", invoiceUrl: "https://pay.example/inv1", hqContactId: "HQ1" } }] });
    expect(await processGhlEvent("E1", "op_invoice", db)).toBe("processed");
    expect(db.claims[0].invoiceId).toBe("inv1");
  });
});

describe("POST /api/webhooks/op/invoice", () => {
  it("answers 200 + reason for missing/wrong secret and misconfiguration; header-only auth (a body secret is not accepted)", async () => {
    vi.resetModules();
    const events: Row[] = [];
    vi.doMock("@/lib/billing/db", () => ({ getBillingDb: async () => ({ ghlEvent: { create: async ({ data }: Row) => (events.push(data), { id: "E1" }), findUnique: async () => null } }) }));
    const { POST } = await import("@/app/api/webhooks/op/invoice/route");
    const call = (headers: Record<string, string>, body: unknown = { customData: { secret: "s3cret" } }) =>
      POST(new NextRequest("http://localhost/api/webhooks/op/invoice", { method: "POST", headers, body: JSON.stringify(body) }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.OP_WEBHOOK_SECRET;
    let r = await call({});
    expect([r.status, (await r.json()).reason]).toEqual([200, "server_misconfigured"]);
    process.env.OP_WEBHOOK_SECRET = "s3cret";
    r = await call({});
    expect((await r.json()).reason).toBe("auth_missing");
    r = await call({ "x-reiblast-op-secret": "wrong" });
    expect((await r.json()).reason).toBe("auth_failed");
    r = await call({ "x-reiblast-events-secret": "s3cret" });
    expect((await r.json()).reason).toBe("auth_missing");
    expect(events).toHaveLength(0);
  });
});
