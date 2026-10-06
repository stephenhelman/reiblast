import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../db", () => ({ getBillingDb: async () => holder.db }));

import { POST as stageChanged } from "@/app/api/webhooks/ghl/stage-changed/route";
import { billingStateForStage, eventForStage } from "../../events/stageChanged";
import { CLIENTS_STAGES, billingStateForClientsStage } from "../../stages";
import { makeFake, member } from "../state/_fake";

const SECRET = "test-events-secret";
const CONTACT = "CONTACTA1xyz";
const post = (body: unknown) =>
  stageChanged(new NextRequest("https://example.test/api/webhooks/ghl/stage-changed", { method: "POST", headers: { "content-type": "application/json", "x-reiblast-events-secret": SECRET }, body: JSON.stringify(body) }));
const NAME_TO_KEY = [["Trial", "trial"], ["Active Member", "active"], ["Payment Failed", "payment_failed"], ["Paused", "paused"], ["Inactive", "inactive"], ["Churned", "churned"]] as const;

beforeEach(() => {
  process.env.GHL_EVENTS_SECRET = SECRET;
  delete process.env.DUNNING_MODE;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Clients stage mapping (pure)", () => {
  it("covers every CLIENTS_STAGES name exactly once", () => {
    expect(NAME_TO_KEY.map(([n]) => n)).toEqual([...CLIENTS_STAGES]);
  });
  it.each(NAME_TO_KEY)("name %s → key %s, and the key itself is accepted", (name, key) => {
    expect(billingStateForClientsStage(name)).toBe(key);
    expect(billingStateForClientsStage(key)).toBe(key);
    expect(eventForStage(name)).toEqual({ kind: "command", stage: key });
    expect(eventForStage(key)).toEqual({ kind: "command", stage: key });
    expect(billingStateForStage(name)).toBe(key);
  });
  it("matching is exact: no case folding, trimming, underscoring, or prototype keys; unknowns are null", () => {
    for (const s of ["paused ", " Paused", "PAUSED", "active member", "Active_Member", "active_member", "Payment failed", "Blocker Detected", "A2P Approved", "", "constructor", "toString", "__proto__"]) {
      expect(billingStateForClientsStage(s)).toBeNull();
      expect(eventForStage(s)).toBeNull();
    }
  });
  it("legacy paused_confirm still parses to the no-op event", () => {
    expect(eventForStage("paused_confirm")).toEqual({ kind: "pause_confirmed" });
  });
});

describe("stage-changed route, active_client: names and keys both drive the engine", () => {
  // Starting states chosen so every target is a real change (and Paused / Inactive / Churned carry saas_pause).
  it.each(NAME_TO_KEY)("name %s and key %s produce the same command decision", async (name, key) => {
    const start = key === "active" ? "paused" : "active";
    holder.db = makeFake([member({ contactId: CONTACT, billingState: start })], [], { writable: true });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: name });
    const byName = holder.db.decisions[0];
    holder.db = makeFake([member({ contactId: CONTACT, billingState: start })], [], { writable: true });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: key });
    const byKey = holder.db.decisions[0];

    expect(byName).toMatchObject({ eventKind: "command", toState: key === "trial" || key === "payment_failed" ? byKey.toState : key });
    for (const f of ["eventKind", "fromState", "toState", "pauseReason", "sideEffects", "reason"] as const) expect(byName[f]).toEqual(byKey[f]);
    expect(byName.trigger).toMatch(new RegExp(`^command:${key}:`)); // canonical key in the trigger whichever form arrived
    expect(holder.db.events[0].processedAt).toBeTruthy();
    expect(holder.db.events[0].lastError).toBeNull();
  });
  it('"Paused" really pauses: manual_killswitch + saas_pause', async () => {
    holder.db = makeFake([member({ contactId: CONTACT, billingState: "active" })], [], { writable: true });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: "Paused" });
    expect(holder.db.decisions[0]).toMatchObject({ toState: "paused", pauseReason: "manual_killswitch", sideEffects: [{ type: "saas_pause" }] });
  });
  it('"Active Member" resumes a paused member', async () => {
    holder.db = makeFake([member({ contactId: CONTACT, billingState: "paused", warningCount: 3, pauseReason: "non_payment" })], [], { writable: true });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: "Active Member" });
    expect(holder.db.decisions[0]).toMatchObject({ toState: "active", toStrikes: 0, sideEffects: [{ type: "saas_resume" }] });
  });
  it("the same move in name then key form within 60 s is one duplicate delivery, not two commands", async () => {
    holder.db = makeFake([member({ contactId: CONTACT, billingState: "active" })], [], { writable: true });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: "Paused" });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: "paused" });
    expect(holder.db.decisions).toHaveLength(1);
    expect(holder.db.events[1].lastError).toMatch(/duplicate delivery/);
  });
  it("names also work inside customData (GHL's standard webhook shape)", async () => {
    holder.db = makeFake([member({ contactId: CONTACT, billingState: "active" })], [], { writable: true });
    await post({ customData: { contactId: CONTACT, pipeline: "active_client", stage: "Churned" } });
    expect(holder.db.decisions[0]).toMatchObject({ toState: "churned" });
  });
  it.each(["PAUSED", "Active member", "Blocker Detected", "Some Custom Stage"])("unknown stage %j: no decision, no guess, recorded as stage_change_unmapped", async (s) => {
    holder.db = makeFake([member({ contactId: CONTACT, billingState: "active" })], [], { writable: true });
    await post({ contactId: CONTACT, pipeline: "active_client", stage: s });
    expect(holder.db.decisions).toHaveLength(0);
    expect(holder.db.events.some((e: any) => e.source === "stage_change_unmapped" && e.externalId === CONTACT)).toBe(true);
    expect(holder.db.events[0].lastError).toMatch(/unrecognized Clients stage/);
  });
});
