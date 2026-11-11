import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => holder.db }));

import { POST } from "@/app/api/webhooks/campaign-event/route";
import { runCampaignSnapshot } from "@/lib/billing/jobs/campaignSnapshot";
import { COUNTER_FIELDS, STEP_TAG_RE, extractTags, fieldsToBump, parseCampaignPayload, stepFromTags } from "../stats";

type Row = Record<string, any>;
const LOC = "LOCATION1234567890ab";
const SECRET = "campaign-test-secret";

/** In-memory db with just the delegates the receiver and the snapshot job touch. */
function fakeDb(accounts: Row[] = [{ id: "A1", locationId: LOC, accountType: "member" }]) {
  const stats: Row[] = [];
  const snaps: Row[] = [];
  const k = (w: Row) => w.locationId_listType_listName_variant;
  const find = (w: Row) => stats.find((r) => ["locationId", "listType", "listName", "variant"].every((f) => r[f] === k(w)[f]));
  const calls = { upsert: 0, update: 0 };
  const state = { raceOnce: false };
  const db: Row = {
    ghlAccount: { findFirst: async ({ where }: Row) => accounts.find((a) => a.locationId === where.locationId && a.accountType === where.accountType) ?? null },
    campaignStats: {
      upsert: async ({ where, create, update }: Row) => {
        calls.upsert++;
        if (state.raceOnce) { state.raceOnce = false; stats.push({ ...Object.fromEntries(COUNTER_FIELDS.map((f) => [f, 0])), ...k(where), firstEventAt: new Date(), lastEventAt: new Date() }); throw Object.assign(new Error("unique"), { code: "P2002" }); }
        const hit = find(where);
        if (!hit) { stats.push({ ...Object.fromEntries(COUNTER_FIELDS.map((f) => [f, 0])), ...create }); return; }
        for (const [f, v] of Object.entries(update) as [string, any][]) hit[f] = v?.increment ? hit[f] + v.increment : v;
      },
      update: async ({ where, data }: Row) => {
        calls.update++;
        const hit = find(where)!;
        for (const [f, v] of Object.entries(data) as [string, any][]) hit[f] = v?.increment ? hit[f] + v.increment : v;
      },
      findMany: async ({ where }: Row = {}) => stats.filter((r) => !where?.firstEventAt?.lt || r.firstEventAt < where.firstEventAt.lt),
    },
    campaignSnapshot: {
      findMany: async ({ where }: Row) => snaps.filter((s) => s.month === where.month),
      createMany: async ({ data }: Row) => {
        let count = 0;
        for (const d of data) if (!snaps.some((s) => s.locationId === d.locationId && s.month === d.month)) { snaps.push({ ...d }); count++; }
        return { count };
      },
    },
  };
  return { db, stats, snaps, calls, state };
}

const req = (body: unknown) => new NextRequest("https://example.test/api/webhooks/campaign-event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const send = async (customData: Row, extra: Row = {}) => (await POST(req({ ...extra, customData: { secret: SECRET, locationId: LOC, ...customData } }))).json();

let f: ReturnType<typeof fakeDb>;
beforeEach(() => {
  process.env.CAMPAIGN_EVENT_SECRET = SECRET;
  f = fakeDb();
  holder.db = f.db;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Custom Data parsing", () => {
  it("reads customData only and trims; blank / whitespace / missing / non-string → ''", () => {
    const r = parseCampaignPayload({ event: "replied", listType: "Probate", customData: { locationId: LOC, event: " Replied ", listType: "  Absentee Owner ", listName: "   ", variant: 5 } });
    expect(r).toEqual({ ok: true, value: { locationId: LOC, event: "replied", listType: "Absentee Owner", listName: "", variant: "" } });
  });
  it("caps listName at 200 and variant at 100 (truncates, never rejects)", () => {
    const r = parseCampaignPayload({ customData: { locationId: LOC, event: "entered", listName: "x".repeat(500), variant: "v".repeat(500) } });
    expect(r.ok && r.value.listName.length).toBe(200);
    expect(r.ok && r.value.variant.length).toBe(100);
  });
  it("requires a well-formed locationId and an allowlisted event", () => {
    expect(parseCampaignPayload({ customData: { locationId: "bad id!", event: "entered" } })).toEqual({ ok: false, reason: "invalid_location" });
    expect(parseCampaignPayload({ customData: { event: "entered" } })).toEqual({ ok: false, reason: "invalid_location" });
    expect(parseCampaignPayload({ customData: { locationId: LOC, event: "clicked" } })).toEqual({ ok: false, reason: "invalid_event" });
    expect(parseCampaignPayload({ customData: { locationId: LOC, event: "" } })).toEqual({ ok: false, reason: "invalid_event" });
  });
  it("blank list fields land as '' in the stored row (not null)", async () => {
    expect(await send({ event: "entered", listType: "", listName: "  ", variant: "Generic #1" })).toEqual({ received: true, reason: "accepted" });
    expect(f.stats[0]).toMatchObject({ listType: "", listName: "", variant: "Generic #1", entered: 1 });
  });
});

describe("step-tag parsing", () => {
  it("accepts an array of tags", () => expect(stepFromTags(extractTags({ tags: ["Hot Lead", "sms 3"] }))).toBe(3));
  it("accepts a comma-separated string", () => expect(stepFromTags(extractTags({ tags: "Hot Lead, SMS 5 ,other" }))).toBe(5));
  it("also finds contact.tags", () => expect(stepFromTags(extractTags({ contact: { tags: ["SMS 2"] } }))).toBe(2));
  it("none → null (and no tags at all → extractTags null)", () => {
    expect(stepFromTags(["a", "b"])).toBeNull();
    expect(extractTags({ foo: 1 })).toBeNull();
    expect(stepFromTags(null)).toBeNull();
  });
  it("several different steps → null; only SMS 1..7 exactly match", () => {
    expect(stepFromTags(["SMS 1", "SMS 2"])).toBeNull();
    for (const t of ["SMS 0", "SMS 8", "SMS 12", "SMS", "sms  3", "xSMS 3"]) expect(STEP_TAG_RE.test(t), t).toBe(false);
    expect(STEP_TAG_RE.test("Sms 7")).toBe(true);
  });
  it("only replied/errored carry a step column", () => {
    expect(fieldsToBump("replied", 3)).toEqual(["replied", "replied3"]);
    expect(fieldsToBump("errored", 7)).toEqual(["errored", "errored7"]);
    expect(fieldsToBump("entered", 3)).toEqual(["entered"]);
    expect(fieldsToBump("no_response", 3)).toEqual(["noResponse"]);
    expect(fieldsToBump("replied", null)).toEqual(["replied"]);
  });
});

describe("receiver: upsert increments", () => {
  it("creates at 1 then increments, incl. step columns, per (list, variant)", async () => {
    const cd = { listType: "Probate", listName: "Oct list", variant: "A" };
    await send({ ...cd, event: "entered" });
    await send({ ...cd, event: "entered" });
    await send({ ...cd, event: "replied" }, { tags: ["SMS 2"] });
    await send({ ...cd, event: "replied" }, { tags: "SMS 2,Hot" });
    await send({ ...cd, event: "replied" }, { tags: ["SMS 1", "SMS 4"] }); // ambiguous → total only
    await send({ ...cd, event: "errored" }, { tags: ["SMS 6"] });
    await send({ ...cd, event: "no_response" });
    expect(f.stats).toHaveLength(1);
    expect(f.stats[0]).toMatchObject({ entered: 2, replied: 3, replied2: 2, replied1: 0, replied4: 0, errored: 1, errored6: 1, noResponse: 1 });
    await send({ ...cd, variant: "B", event: "entered" });
    expect(f.stats).toHaveLength(2); // another variant = another row
  });
  it("the first event creates the row with that counter (and its step) at 1 and sets first/lastEventAt", async () => {
    await send({ event: "errored" }, { tags: ["SMS 3"] });
    expect(f.stats[0]).toMatchObject({ errored: 1, errored3: 1, entered: 0 });
    expect(f.stats[0].firstEventAt).toBeInstanceOf(Date);
    expect(f.stats[0].lastEventAt).toBeInstanceOf(Date);
  });
  it("a create race (P2002) retries once as an update, and the event is counted", async () => {
    f.state.raceOnce = true;
    expect(await send({ event: "entered" })).toEqual({ received: true, reason: "accepted" });
    expect(f.calls).toEqual({ upsert: 1, update: 1 });
    expect(f.stats[0].entered).toBe(1);
  });
});

describe("receiver: rejections are 200s that write nothing", () => {
  it("unknown location (and non-member accounts)", async () => {
    expect(await send({ event: "entered", locationId: "OTHERLOCATION1234567" })).toEqual({ received: false, reason: "unknown_location" });
    f = fakeDb([{ id: "A9", locationId: LOC, accountType: "internal" }]);
    holder.db = f.db;
    expect(await send({ event: "entered" })).toMatchObject({ reason: "unknown_location" });
    expect(f.stats).toHaveLength(0);
  });
  it("auth: missing, wrong, misconfigured; bad json; invalid event/location", async () => {
    expect(await send({ event: "entered", secret: "" })).toMatchObject({ reason: "auth_missing" });
    expect(await send({ event: "entered", secret: "nope" })).toMatchObject({ reason: "auth_failed" });
    expect(await send({ event: "bogus" })).toMatchObject({ reason: "invalid_event" });
    expect(await send({ event: "entered", locationId: "x" })).toMatchObject({ reason: "invalid_location" });
    const bad = await POST(new NextRequest("https://example.test/x", { method: "POST", body: "not json" }));
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ reason: "bad_json" });
    delete process.env.CAMPAIGN_EVENT_SECRET;
    expect(await send({ event: "entered" })).toMatchObject({ reason: "server_misconfigured" });
    expect(f.stats).toHaveLength(0);
  });
  it("a DB error still answers 200 internal_error, without leaking details", async () => {
    f.db.ghlAccount.findFirst = async () => { throw new Error("db down: secret detail"); };
    const res = await POST(req({ customData: { secret: SECRET, locationId: LOC, event: "entered" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: false, reason: "internal_error" });
  });
  it("a request with the secret never stores it (no payload persistence at all)", async () => {
    await send({ event: "entered" });
    expect(JSON.stringify(f.stats)).not.toContain(SECRET);
  });
});

describe("campaign_snapshot job", () => {
  const NOW = new Date("2026-12-01T08:00:00Z"); // Dec 1 Denver → snapshot November
  const ctx = (db: unknown, over: Row = {}) => ({ db: db as never, apply: true, cursor: null, now: NOW, shouldYield: () => false, ...over });
  const seed = () => {
    const base = Object.fromEntries(COUNTER_FIELDS.map((c) => [c, 0]));
    f.stats.push(
      { ...base, locationId: LOC, listType: "Probate", listName: "L1", variant: "A", entered: 10, replied: 2, replied1: 1, firstEventAt: new Date("2026-10-05T00:00:00Z"), lastEventAt: new Date("2026-11-20T00:00:00Z") },
      { ...base, locationId: LOC, listType: "", listName: "", variant: "Generic #1", entered: 5, errored: 1, errored3: 1, firstEventAt: new Date("2026-11-02T00:00:00Z"), lastEventAt: new Date("2026-11-20T00:00:00Z") },
      { ...base, locationId: "LATELOCATION12345678", listType: "", listName: "", variant: "", entered: 1, firstEventAt: new Date("2026-12-01T07:00:00Z"), lastEventAt: new Date("2026-12-01T07:00:00Z") },
    );
  };
  it("writes one cumulative snapshot per location with a breakdown, for the month just ended", async () => {
    seed();
    const r = await runCampaignSnapshot(ctx(f.db));
    expect(r.summary).toMatchObject({ month: "2026-11", created: 1 });
    expect(f.snaps).toHaveLength(1); // the location whose stats began after month end is left out
    expect(f.snaps[0]).toMatchObject({ locationId: LOC, month: "2026-11", entered: 15, replied: 2, replied1: 1, errored: 1, errored3: 1 });
    expect(f.snaps[0].breakdown).toHaveLength(2);
    expect(f.snaps[0].breakdown[0]).toMatchObject({ listType: "", variant: "Generic #1", entered: 5 });
  });
  it("is idempotent: re-running writes nothing, and a later run for the same month does not overwrite", async () => {
    seed();
    await runCampaignSnapshot(ctx(f.db));
    f.stats[0].entered = 999; // activity after the snapshot
    const again = await runCampaignSnapshot(ctx(f.db));
    expect(again.summary).toMatchObject({ created: 0, alreadySnapshotted: 1 });
    expect(f.snaps).toHaveLength(1);
    expect(f.snaps[0].entered).toBe(15);
  });
  it("dry-run writes nothing", async () => {
    seed();
    const r = await runCampaignSnapshot(ctx(f.db, { apply: false }));
    expect(r.summary).toMatchObject({ dryRun: true, wouldCreate: 1, created: 0 });
    expect(f.snaps).toHaveLength(0);
  });
});
