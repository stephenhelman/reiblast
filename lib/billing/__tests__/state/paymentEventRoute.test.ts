import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any, boom: false }));
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => { if (holder.boom) throw new Error("db down"); return holder.db; } }));
vi.mock("@/lib/billing/processPaymentEvent", () => ({ processPaymentEvent: vi.fn(async () => "processed") }));

import { POST as paymentEvent } from "@/app/api/webhooks/ghl/payment-event/route";
import { processPaymentEvent } from "@/lib/billing/processPaymentEvent";

const SECRET = "test-billing-secret";

function makeDb() {
  const events: any[] = [];
  return { events, ghlEvent: { create: async ({ data }: any) => { const row = { id: `e${events.length + 1}`, ...data }; events.push(row); return row; } } };
}

const req = (body: unknown, headers: Record<string, string> = { "x-reiblast-billing-secret": SECRET }, raw?: string) =>
  new NextRequest("https://example.test/api/webhooks/ghl/payment-event", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) });

beforeEach(() => {
  process.env.GHL_BILLING_WEBHOOK_SECRET = SECRET;
  holder.db = makeDb();
  holder.boom = false;
  vi.mocked(processPaymentEvent).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("payment-event route: split reason codes, always 200", () => {
  it("GHL_BILLING_WEBHOOK_SECRET unset → server_misconfigured, and the missing var name (never a value) is logged", async () => {
    delete process.env.GHL_BILLING_WEBHOOK_SECRET;
    const errSpy = vi.spyOn(console, "error");
    const res = await paymentEvent(req({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: false, reason: "server_misconfigured" });
    expect(errSpy.mock.calls.some((c) => c.join(" ").includes("GHL_BILLING_WEBHOOK_SECRET"))).toBe(true);
  });
  it("missing header → auth_missing; wrong secret → auth_failed", async () => {
    expect(await (await paymentEvent(req({}, {}))).json()).toEqual({ received: false, reason: "auth_missing" });
    expect(await (await paymentEvent(req({}, { "x-reiblast-billing-secret": "nope" }))).json()).toEqual({ received: false, reason: "auth_failed" });
  });
  it("invalid JSON → bad_json", async () => {
    expect(await (await paymentEvent(req(null, undefined, "{not json"))).json()).toEqual({ received: false, reason: "bad_json" });
  });
  it("a fully accepted event → accepted", async () => {
    const res = await paymentEvent(req({ transactionId: "tx1" }));
    expect(await res.json()).toEqual({ received: true, reason: "accepted" });
    expect(holder.db.events).toHaveLength(1);
    expect(processPaymentEvent).toHaveBeenCalledTimes(1);
  });
  it("a database that is down (not a missing env var) → internal_error, not server_misconfigured", async () => {
    holder.boom = true;
    const res = await paymentEvent(req({ transactionId: "tx1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: false, reason: "internal_error" });
  });
  it("the GhlEvent insert itself failing still returns a reason (internal_error) — never masked, and processing never runs without a record", async () => {
    holder.db.ghlEvent.create = async () => { throw new Error("insert exploded"); };
    const res = await paymentEvent(req({ transactionId: "tx1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: false, reason: "internal_error" });
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });
  it("an internal_error log carries the message (and, when present, a stack) but the HTTP response never does", async () => {
    holder.boom = true;
    const errSpy = vi.spyOn(console, "error");
    const res = await paymentEvent(req({ transactionId: "tx1" }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
    expect(errSpy.mock.calls.some((c) => c.join(" ").includes("db down"))).toBe(true);
  });
});
