import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking convention as lib/billing/__tests__/state/routes.test.ts.
const holder = vi.hoisted(() => ({ db: null as any, boom: false }));
vi.mock("../../db", () => ({ getBillingDb: async () => { if (holder.boom) throw new Error("db down"); return holder.db; } }));

import { POST as stageChanged } from "@/app/api/webhooks/ghl/stage-changed/route";
import { makeFake, member } from "../state/_fake";

const SECRET = "test-events-secret";
const CONTACT = "CONTACTA1xyz";
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("https://example.test/api/webhooks/ghl/stage-changed", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const stage = (body: unknown, headers?: Record<string, string>) => stageChanged(req(body, headers));

beforeEach(() => {
  process.env.GHL_EVENTS_SECRET = SECRET;
  delete process.env.DUNNING_MODE;
  holder.boom = false;
  holder.db = makeFake([member({ contactId: CONTACT })], [], { writable: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GHL standard webhook shape: customData-first field parsing", () => {
  it("parses contactId/pipeline/stage from customData, with a valid header", async () => {
    const res = await stage(
      { someGhlDefaultField: "ignored", customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client" } },
      { "x-reiblast-events-secret": SECRET },
    );
    expect(await res.json()).toEqual({ received: true, reason: "accepted" });
    expect(holder.db.events).toHaveLength(1);
    expect(holder.db.events[0].externalId).toBe(CONTACT);
  });

  it("still works with a flat top-level body (manual/curl testing fallback)", async () => {
    const res = await stage({ contactId: CONTACT, pipeline: "onboarding", stage: "New Client" }, { "x-reiblast-events-secret": SECRET });
    expect(await res.json()).toEqual({ received: true, reason: "accepted" });
    expect(holder.db.events[0].externalId).toBe(CONTACT);
  });

  it("customData takes priority over a conflicting top-level field", async () => {
    const res = await stage(
      { contactId: "WRONGCONTACTID1", customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client" } },
      { "x-reiblast-events-secret": SECRET },
    );
    expect(await res.json()).toEqual({ received: true, reason: "accepted" });
    expect(holder.db.events[0].externalId).toBe(CONTACT);
  });
});

describe("auth: header OR customData.secret", () => {
  it("accepts a valid header with no customData.secret present", async () => {
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client" } }, { "x-reiblast-events-secret": SECRET });
    expect(await res.json()).toMatchObject({ reason: "accepted" });
  });

  it("accepts a valid customData.secret with no header present", async () => {
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client", secret: SECRET } });
    expect(await res.json()).toMatchObject({ reason: "accepted" });
  });

  it("rejects when neither header nor customData.secret is present", async () => {
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client" } });
    expect(await res.json()).toEqual({ received: false, reason: "auth_missing" });
    expect(holder.db.events).toHaveLength(0);
  });

  it("rejects a wrong customData.secret even with no header (timing-safe compare just fails, never throws on length mismatch)", async () => {
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client", secret: "x" } });
    expect(await res.json()).toEqual({ received: false, reason: "auth_failed" });
    expect(holder.db.events).toHaveLength(0);
  });

  it("rejects a wrong header even when customData.secret is also wrong", async () => {
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client", secret: "nope" } }, { "x-reiblast-events-secret": "also-nope" });
    expect(await res.json()).toEqual({ received: false, reason: "auth_failed" });
  });

  it("a correct customData.secret still authenticates even when an incorrect header is also present", async () => {
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client", secret: SECRET } }, { "x-reiblast-events-secret": "wrong" });
    expect(await res.json()).toMatchObject({ reason: "accepted" });
  });

  it("server_misconfigured (missing env var) wins over any auth outcome", async () => {
    delete process.env.GHL_EVENTS_SECRET;
    const res = await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client", secret: "whatever" } }, { "x-reiblast-events-secret": "whatever" });
    expect(await res.json()).toEqual({ received: false, reason: "server_misconfigured" });
  });
});

describe("the shared secret is never persisted", () => {
  it("customData.secret is redacted from the stored GhlEvent payload", async () => {
    await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client", secret: SECRET } });
    expect(holder.db.events).toHaveLength(1);
    const stored = holder.db.events[0].payload as any;
    expect(stored.customData.secret).toBe("[redacted]");
    expect(JSON.stringify(stored)).not.toContain(SECRET);
  });

  it("a request authenticated via header (no customData.secret) has nothing to redact and stores the body as-is", async () => {
    await stage({ customData: { contactId: CONTACT, pipeline: "onboarding", stage: "New Client" } }, { "x-reiblast-events-secret": SECRET });
    const stored = holder.db.events[0].payload as any;
    expect(stored.customData).toEqual({ contactId: CONTACT, pipeline: "onboarding", stage: "New Client" });
  });
});
