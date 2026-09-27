import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any, boom: false }));
vi.mock("../../db", () => ({ getBillingDb: async () => { if (holder.boom) throw new Error("db down"); return holder.db; } }));
const invoices = vi.hoisted(() => ({ byId: {} as Record<string, unknown>, fetches: 0 }));
vi.mock("../../invoices", async (orig) => ({ ...(await orig<typeof import("../../invoices")>()), fetchInvoice: vi.fn(async (id: string) => { invoices.fetches++; const inv = invoices.byId[id]; if (inv === "ERROR") throw new Error("GHL invoice read failed: HTTP 500"); return inv ?? null; }) }));

import { POST as stageChanged } from "@/app/api/webhooks/ghl/stage-changed/route";
import { POST as invoiceEvent } from "@/app/api/webhooks/ghl/invoice-event/route";
import { processGhlEvent } from "../../events/process";
import { parseInvoice } from "../../invoices";
import { makeFake, member } from "./_fake";

const SECRET = "test-events-secret";
const CONTACT = "CONTACTA1xyz";
const req = (path: string, body: unknown, headers: Record<string, string> = { "x-reiblast-events-secret": SECRET }, raw?: string) =>
  new NextRequest(`https://example.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) });
const stage = (body: unknown, headers?: Record<string, string>, raw?: string) => stageChanged(req("/api/webhooks/ghl/stage-changed", body, headers, raw));
const invoice = (body: unknown, headers?: Record<string, string>) => invoiceEvent(req("/api/webhooks/ghl/invoice-event", body, headers));

beforeEach(() => {
  process.env.GHL_EVENTS_SECRET = SECRET;
  delete process.env.DUNNING_MODE;
  holder.boom = false;
  invoices.byId = {};
  invoices.fetches = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
const setup = (over = {}, opts: { writable?: boolean } = { writable: true }) => (holder.db = makeFake([member({ contactId: CONTACT, ...over })], [], opts));

describe("stage-changed route: auth, recording, always 200", () => {
  it("a missing or wrong secret → 200, reason says which, and NOTHING is recorded or decided", async () => {
    const db = setup();
    const cases: [Record<string, string>, string][] = [
      [{}, "auth_missing"],
      [{ "x-reiblast-events-secret": "nope" }, "auth_failed"],
      [{ "x-reiblast-events-secret": "" }, "auth_missing"],
    ];
    for (const [headers, reason] of cases) {
      const res = await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" }, headers);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: false, reason });
    }
    expect(db.events).toHaveLength(0);
    expect(db.decisions).toHaveLength(0);
  });
  it("with GHL_EVENTS_SECRET unset nothing is ever accepted, reason server_misconfigured", async () => {
    delete process.env.GHL_EVENTS_SECRET;
    const db = setup();
    const res = await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: false, reason: "server_misconfigured" });
    expect(db.events).toHaveLength(0);
  });
  it("invalid JSON / non-object bodies → 200, reason bad_json, nothing recorded", async () => {
    const db = setup();
    for (const res of [await stage(null, undefined, "{not json"), await stage(null, undefined, "[1,2]")]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: false, reason: "bad_json" });
    }
    expect(db.events).toHaveLength(0);
  });
  it("a successful record+process → reason accepted", async () => {
    setup({ billingState: "active" });
    const res = await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(await res.json()).toEqual({ received: true, reason: "accepted" });
  });
  it("records the GhlEvent FIRST: if processing blows up the event still exists with attempts and the error", async () => {
    const db = setup();
    db.dunningDecision.findUnique = async () => { throw new Error("db exploded"); };
    const res = await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(res.status).toBe(200);
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ source: "stage_change", externalId: CONTACT, attempts: 1, lastError: "db exploded", processedAt: null });
  });
  it("a database that is completely down still answers 200", async () => {
    holder.boom = true;
    expect((await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" })).status).toBe(200);
  });
});

describe("stage-changed: onboarding pipeline (display data only)", () => {
  it("updates GhlAccount.onboardingStage and makes NO engine decision", async () => {
    const db = setup({ onboardingStage: "Onboarding Form Submitted" });
    await stage({ contactId: CONTACT, pipeline: "onboarding", stage: "Active Member" });
    expect(db.ghlEvent).toBeDefined();
    expect(db.writes).toEqual([`ghlAccount.update ${JSON.stringify({ onboardingStage: "Active Member" })}`]);
    expect(db.decisions).toHaveLength(0);
    expect(db.events[0].processedAt).toBeInstanceOf(Date);
  });
  it("no write when the stage is unchanged", async () => {
    const db = setup({ onboardingStage: "Active Member" });
    await stage({ contactId: CONTACT, pipeline: "onboarding", stage: "Active Member" });
    expect(db.writes).toEqual([]);
  });
});

describe("stage-changed: active_client → engine (shadow: decisions only)", () => {
  it("a manual move to paused is a COMMAND: paused/manual_killswitch, an intent recorded as skipped_shadow, NO side effect and NO account write", async () => {
    const db = setup({ billingState: "active" }, { writable: true });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]).toMatchObject({ mode: "shadow", eventKind: "command", fromState: "active", toState: "paused", pauseReason: "manual_killswitch", sideEffects: [] });
    expect(db.decisions[0].trigger).toBe(`command:paused:${db.events[0].id}`);
    expect(db.intents.map((i: any) => i.status)).toEqual(["skipped_shadow"]);
    expect(db.writes).toEqual([]); // shadow never writes account state
  });
  it("the ECHO of a state the account is already in is a confirmation: no change, no intent", async () => {
    const db = setup({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(db.decisions[0]).toMatchObject({ fromState: "paused", toState: "paused", pauseReason: "non_payment", sideEffects: [], reason: expect.stringMatching(/confirmation/) });
    expect(db.intents).toHaveLength(0);
  });
  it("manual active / inactive / churned commands", async () => {
    let db = setup({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "active" });
    expect(db.decisions[0]).toMatchObject({ toState: "active", toStrikes: 0, sideEffects: [expect.objectContaining({ type: "saas_resume" })] });
    db = setup({ billingState: "active" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "inactive" });
    expect(db.decisions[0]).toMatchObject({ toState: "inactive", pauseReason: "voluntary", sideEffects: [expect.objectContaining({ type: "saas_pause" })] });
    db = setup({ billingState: "active" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "churned" });
    expect(db.decisions[0]).toMatchObject({ toState: "churned", sideEffects: [expect.objectContaining({ type: "saas_pause" })] });
  });
  it("paused_confirm while STILL paused → the decision's side effect is saas_pause (recorded; nothing executes in shadow)", async () => {
    const db = setup({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused_confirm" });
    expect(db.decisions[0]).toMatchObject({ eventKind: "pause_confirmed", toState: "paused", sideEffects: [{ type: "saas_pause" }] });
    expect(db.decisions[0].trigger).toBe(`command:paused_confirm:${db.events[0].id}`);
    expect(db.writes).toEqual([]);
  });
  it("paused_confirm after a cure → recorded 'cured before confirmation, no pause'", async () => {
    const db = setup({ billingState: "active" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused_confirm" });
    expect(db.decisions[0]).toMatchObject({ eventKind: "pause_confirmed", sideEffects: [] });
    expect(db.decisions[0].reason).toMatch(/cured before confirmation, no pause/);
  });
  it("payment_failed / trial moves (GHL's own display stages) are recorded as 'command not supported' no-ops; an unknown stage is ignored entirely", async () => {
    const db = setup({ billingState: "active" });
    for (const s of ["payment_failed", "trial", "Some Custom Stage"]) await stage({ contactId: CONTACT, pipeline: "active_client", stage: s });
    expect(db.decisions).toHaveLength(2);
    expect(db.decisions.every((d: any) => d.fromState === "active" && d.toState === "active" && /command not supported/.test(d.reason))).toBe(true);
    expect(db.intents).toHaveLength(0);
    expect(db.events).toHaveLength(3);
    expect(db.events.every((e: any) => e.processedAt)).toBe(true);
    expect(db.events[2].lastError).toMatch(/not a billing stage/);
  });
  it("an unknown contact, an internal account, or a malformed payload is recorded and ignored (no error, no retry)", async () => {
    const db = setup({ accountType: "internal" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    await stage({ contactId: "SOMEONEELSE1", pipeline: "active_client", stage: "paused" });
    await stage({ contactId: CONTACT, pipeline: "bogus", stage: "paused" });
    await stage({ contactId: "x", pipeline: "active_client", stage: "paused" });
    await stage({ pipeline: "active_client" });
    expect(db.decisions).toHaveLength(0);
    expect(db.events).toHaveLength(5);
    expect(db.events.every((e: any) => e.processedAt && e.attempts === 0)).toBe(true);
    expect(db.events[0].lastError).toMatch(/no member account/);
  });
  it("a repeat delivery of the same move within a minute is a duplicate; a genuine paused → active → paused is not", async () => {
    let db = setup({ billingState: "active" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(db.decisions).toHaveLength(1);
    expect(db.events[1].lastError).toMatch(/duplicate delivery/);
    db = setup({ billingState: "active" });
    for (const s of ["paused", "active", "paused"]) await stage({ contactId: CONTACT, pipeline: "active_client", stage: s });
    expect(db.decisions.map((d: any) => d.toState)).toEqual(["paused", "active", "paused"]);
    expect(new Set(db.decisions.map((d: any) => d.trigger)).size).toBe(3); // command:<stage>:<eventId> — distinct per event
  });
  it("the replay job's dispatcher retries a failed stage_change event through the RIGHT processor", async () => {
    const db = setup({ billingState: "active" });
    const realFind = db.dunningDecision.findUnique;
    db.dunningDecision.findUnique = async () => { throw new Error("transient"); };
    await stage({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(db.events[0]).toMatchObject({ attempts: 1, processedAt: null });
    db.dunningDecision.findUnique = realFind;
    expect(await processGhlEvent(db.events[0].id, "stage_change", db)).toBe("processed");
    expect(db.decisions).toHaveLength(1);
    expect(db.events[0].processedAt).toBeInstanceOf(Date);
  });
});

const inv = (o: Record<string, unknown> = {}) => parseInvoice({ _id: "INVOICE0000001", status: "sent", source: "payments_subscription", dueDate: "2026-09-18T05:59:59.999Z", amountDue: 57, contactDetails: { id: CONTACT }, ...o })!;

describe("invoice-event route", () => {
  it("auth: a bad secret → 200, nothing recorded, no invoice fetched", async () => {
    const db = setup();
    expect((await invoice({ invoiceId: "INVOICE0000001" }, { "x-reiblast-events-secret": "nope" })).status).toBe(200);
    expect(db.events).toHaveLength(0);
    expect(invoices.fetches).toBe(0);
  });
  it("an expired (past due, unpaid) CORE recovery invoice → invoice_expired → paused/expired_invoice, no saas_pause", async () => {
    invoices.byId.INVOICE0000001 = inv();
    const db = setup({ billingState: "active" });
    await invoice({ invoiceId: "INVOICE0000001" });
    expect(db.events[0]).toMatchObject({ source: "invoice", externalId: "INVOICE0000001" });
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]).toMatchObject({ trigger: "invoice:INVOICE0000001", eventKind: "invoice_expired", toState: "paused", pauseReason: "expired_invoice", coreFailureOpen: true, sideEffects: [] });
    expect(db.intents.map((i: any) => i.status)).toEqual(["skipped_shadow"]);
  });
  it("a voided unpaid invoice expires too", async () => {
    invoices.byId.INVOICE0000001 = inv({ status: "void", dueDate: "2099-01-01T00:00:00Z" });
    const db = setup({ billingState: "active" });
    await invoice({ invoiceId: "INVOICE0000001" });
    expect(db.decisions[0].toState).toBe("paused");
  });
  it("not expired / paid / draft / not a core invoice → recorded, no decision", async () => {
    const db = setup({ billingState: "active" });
    const cases: [string, any][] = [
      ["INVOICE0000002", inv({ _id: "INVOICE0000002", dueDate: "2099-01-01T00:00:00Z" })], // sent, not yet due
      ["INVOICE0000003", inv({ _id: "INVOICE0000003", status: "paid", amountDue: 0 })],
      ["INVOICE0000004", inv({ _id: "INVOICE0000004", status: "draft" })],
      ["INVOICE0000005", inv({ _id: "INVOICE0000005", source: "manual" })], // past due but not a core recovery invoice
    ];
    for (const [id, i] of cases) { invoices.byId[id] = i; await invoice({ invoiceId: id }); }
    expect(db.decisions).toHaveLength(0);
    expect(db.events).toHaveLength(4);
    expect(db.events.every((e: any) => e.processedAt)).toBe(true);
    expect(db.events[3].lastError).toMatch(/not a core invoice/);
  });
  it("coverage is honored: recorded as 'covered, ignored'", async () => {
    invoices.byId.INVOICE0000001 = inv();
    const db = setup({ billingState: "active", coreCoveredUntil: new Date("2099-01-01T00:00:00Z") });
    await invoice({ invoiceId: "INVOICE0000001" });
    expect(db.decisions[0]).toMatchObject({ toState: "active", coreFailureOpen: false });
    expect(db.decisions[0].reason).toMatch(/covered, ignored/);
  });
  it("idempotent: the same invoice delivered twice decides once", async () => {
    invoices.byId.INVOICE0000001 = inv();
    const db = setup({ billingState: "active" });
    await invoice({ invoiceId: "INVOICE0000001" });
    await invoice({ invoiceId: "INVOICE0000001" });
    expect(db.decisions).toHaveLength(1);
    expect(db.events).toHaveLength(2);
  });
  it("a fetch failure is recorded on the event for retry (attempts, lastError); an unknown contact / bad id is ignored cleanly", async () => {
    let db = setup();
    invoices.byId.INVOICE0000001 = "ERROR";
    await invoice({ invoiceId: "INVOICE0000001" });
    expect(db.events[0]).toMatchObject({ attempts: 1, processedAt: null, lastError: expect.stringMatching(/HTTP 500/) });
    db = setup();
    invoices.byId.INVOICE0000009 = inv({ _id: "INVOICE0000009", contactDetails: { id: "NOBODYKNOWS1" } });
    await invoice({ invoiceId: "INVOICE0000009" });
    await invoice({ invoiceId: "bad id!" });
    await invoice({});
    expect(db.decisions).toHaveLength(0);
    expect(db.events.every((e: any) => e.processedAt)).toBe(true);
  });
});

describe("invoice parsing and expiry", () => {
  it("parses the GHL shape and marks core recovery invoices by source", () => {
    const i = inv();
    expect(i).toMatchObject({ id: "INVOICE0000001", status: "sent", contactId: CONTACT, amountDue: 57, isCore: true });
    expect(inv({ source: "manual" }).isCore).toBe(false);
    expect(parseInvoice(null)).toBeNull();
    expect(parseInvoice({ _id: "x" })).toBeNull();
  });
});
