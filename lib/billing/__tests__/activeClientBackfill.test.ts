import { describe, expect, it, vi } from "vitest";
import { lookupClientsOpportunity, runActiveClientBackfill, type OpportunityLookup } from "../activeClientBackfill";
import { makeFake, member } from "./state/_fake";

const ENV = { GHL_HQ_API_KEY: "k", GHL_HQ_LOCATION_ID: "LOC", GHL_CLIENTS_PIPELINE_ID: "PIPE" };
const res = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

describe("lookupClientsOpportunity (read-only GET)", () => {
  it("GETs the Clients pipeline search for the contact; found with createdAt", async () => {
    const f = vi.fn(async () => res({ opportunities: [{ createdAt: "2026-08-01T10:00:00Z" }] }));
    const r = await lookupClientsOpportunity("C1", ENV, f as never);
    expect(r).toEqual({ found: true, createdAt: new Date("2026-08-01T10:00:00Z") });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/opportunities/search?location_id=LOC&pipeline_id=PIPE&contact_id=C1");
    expect(init.method).toBeUndefined(); // GET
  });
  it("none → found:false; found without a usable date → createdAt null", async () => {
    expect(await lookupClientsOpportunity("C1", ENV, (async () => res({ opportunities: [] })) as never)).toEqual({ found: false });
    expect(await lookupClientsOpportunity("C1", ENV, (async () => res({ opportunities: [{}] })) as never)).toEqual({ found: true, createdAt: null });
  });
  it("an API failure throws (never reads as 'no card'); missing env throws", async () => {
    await expect(lookupClientsOpportunity("C1", ENV, (async () => res({}, false, 500)) as never)).rejects.toThrow(/HTTP 500/);
    await expect(lookupClientsOpportunity("C1", {}, vi.fn() as never)).rejects.toThrow(/must be set/);
  });
});

describe("runActiveClientBackfill", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");
  const rig = () => makeFake([
    member({ id: "A1", contactId: "C1", activeClientSince: null, billingState: "active" }),
    member({ id: "A2", contactId: "C2", activeClientSince: null, billingState: "trial" }),
    member({ id: "A3", contactId: "C3", activeClientSince: null, billingState: null }),
    member({ id: "A4", contactId: "C4", activeClientSince: new Date("2026-09-01T00:00:00Z") }), // already handed off: not looked up
    member({ id: "A5", contactId: "C5", activeClientSince: null, accountType: "internal" }), // not a member
  ], [], { writable: true });
  const lookup = (map: Record<string, OpportunityLookup | "ERR">) => vi.fn(async (c: string) => { const v = map[c]; if (v === "ERR") throw new Error("HTTP 429"); return v; });

  it("dry-run: reports counts and the call estimate, looks up only pending members, writes nothing", async () => {
    const db = rig();
    const lk = lookup({ C1: { found: true, createdAt: new Date("2026-08-01") }, C2: { found: false }, C3: "ERR" });
    const r = await runActiveClientBackfill(db, { apply: false, lookup: lk, now: NOW });
    expect(r).toMatchObject({ members: 3, calls: 3, withoutCard: 1, applied: 0 });
    expect(r.withCard).toEqual([{ accountId: "A1", contactId: "C1", billingState: "active", since: new Date("2026-08-01") }]);
    expect(r.errors).toEqual([{ accountId: "A3", contactId: "C3", error: "HTTP 429" }]);
    expect(lk).toHaveBeenCalledTimes(3);
    expect(db.writes).toEqual([]);
  });
  it("--apply sets activeClientSince only for members with a card (opportunity date, else now); errors and no-card members are untouched; guarded", async () => {
    const db = rig();
    const lk = lookup({ C1: { found: true, createdAt: null }, C2: { found: false }, C3: "ERR" });
    const r = await runActiveClientBackfill(db, { apply: true, lookup: lk, now: NOW });
    expect(r.applied).toBe(1);
    expect(db.writes).toEqual([`ghlAccount.updateMany ${JSON.stringify({ activeClientSince: NOW })}`]);
    expect((await db.ghlAccount.findUnique({ where: { id: "A1" } })).activeClientSince).toEqual(NOW);
    expect((await db.ghlAccount.findUnique({ where: { id: "A2" } })).activeClientSince).toBeNull();
  });
  it("spaces the lookups by pauseMs (not after the last)", async () => {
    const sleep = vi.fn(async () => {});
    await runActiveClientBackfill(rig(), { apply: false, lookup: lookup({ C1: { found: false }, C2: { found: false }, C3: { found: false } }), pauseMs: 250, sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
