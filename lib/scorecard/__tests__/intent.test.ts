import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SCORECARD_DEDUPE_PREFIX, intentUrl, sendPendingIntents } from "@/lib/billing/intents/send";
import { buildScorecardPayload, enqueueScorecardIntent, isoWeekKey, scorecardDedupeKey, scorecardIntentsMode, scorecardViewUrl } from "../intent";

describe("isoWeekKey (Denver calendar day, ISO weeks)", () => {
  it.each([
    ["2026-11-13T18:00:00Z", "2026-W46"], // Friday
    ["2026-11-16T14:00:00Z", "2026-W47"], // Monday
    ["2026-01-01T18:00:00Z", "2026-W01"], // Thursday
    ["2025-12-29T18:00:00Z", "2026-W01"], // Monday belonging to next ISO year
    ["2027-01-01T18:00:00Z", "2026-W53"], // Friday still in 2026's week 53
    ["2026-12-31T18:00:00Z", "2026-W53"],
  ])("%s → %s", (iso, want) => expect(isoWeekKey(new Date(iso))).toBe(want));
  it("uses Denver time, not UTC: Sunday night Denver is still the old week", () => {
    expect(isoWeekKey(new Date("2026-11-16T06:30:00Z"))).toBe("2026-W46"); // Sun 23:30 MST
    expect(isoWeekKey(new Date("2026-11-16T07:30:00Z"))).toBe("2026-W47"); // Mon 00:30 MST
  });
});

describe("keys, url, payload", () => {
  it("dedupe key is scorecard:<locationId>:<week>", () => expect(scorecardDedupeKey("LOC1", "2026-W46")).toBe("scorecard:LOC1:2026-W46"));
  it("view url is TOOLS_URL + /scorecard/view?t=<token>", () => {
    expect(scorecardViewUrl("a.b.c")).toBe("https://tools.reiblast.app/scorecard/view?t=a.b.c");
    expect(scorecardViewUrl("a.b.c", "http://localhost:3001")).toBe("http://localhost:3001/scorecard/view?t=a.b.c");
  });
  it("payload is exactly { intent, hqContactId, scorecardUrl }", () => {
    expect(buildScorecardPayload("HQC", "https://x")).toEqual({ intent: "scorecard_ready", hqContactId: "HQC", scorecardUrl: "https://x" });
  });
  it("mode: only SCORECARD_INTENTS=live is live", () => {
    expect(scorecardIntentsMode({ SCORECARD_INTENTS: "live" })).toBe("live");
    for (const v of [undefined, "", "off", "LIVE", "true"]) expect(scorecardIntentsMode({ SCORECARD_INTENTS: v })).toBe("shadow");
  });
});

type Row = Record<string, any>;
const makeDb = () => {
  const rows: Row[] = [];
  return {
    rows,
    ghlIntent: {
      create: async ({ data }: any) => {
        if (rows.some((r) => r.dedupeKey === data.dedupeKey)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" });
        const r = { id: `i${rows.length + 1}`, attempts: 0, ...data };
        rows.push(r);
        return { id: r.id };
      },
      findUnique: async ({ where }: any) => rows.find((r) => r.dedupeKey === where.dedupeKey) ?? null,
    },
  } as any;
};
const args = { account: { id: "A1", contactId: "HQC12345" }, locationId: "LOC1", week: "2026-W46", scorecardUrl: "https://t/scorecard/view?t=abc" };

describe("enqueueScorecardIntent", () => {
  it("records pending when live, skipped_shadow otherwise; scorecard pipeline/kind", async () => {
    const live = makeDb();
    await enqueueScorecardIntent(live, { ...args, env: { SCORECARD_INTENTS: "live" } });
    expect(live.rows[0]).toMatchObject({ status: "pending", pipeline: "scorecard", kind: "scorecard", ghlAccountId: "A1", dedupeKey: "scorecard:LOC1:2026-W46", payload: { intent: "scorecard_ready", hqContactId: "HQC12345", scorecardUrl: args.scorecardUrl } });
    const off = makeDb();
    await enqueueScorecardIntent(off, { ...args, env: {} });
    expect(off.rows[0].status).toBe("skipped_shadow");
  });
  it("is idempotent on the key and never overwrites the stored link", async () => {
    const db = makeDb();
    const a = await enqueueScorecardIntent(db, { ...args, env: {} });
    const b = await enqueueScorecardIntent(db, { ...args, scorecardUrl: "https://t/scorecard/view?t=OTHER", env: {} });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].payload.scorecardUrl).toBe(args.scorecardUrl);
  });
});

describe("outbox wiring: intentUrl + sendPendingIntents filter", () => {
  it("intentUrl maps the scorecard pipeline to GHL_INTENT_URL_SCORECARD (and only it)", () => {
    expect(intentUrl("scorecard", { GHL_INTENT_URL_SCORECARD: "https://hook/sc", GHL_INTENT_URL_FOUNDER: "https://hook/f" })).toBe("https://hook/sc");
    expect(intentUrl("scorecard", {})).toBeNull();
    expect(intentUrl("founder", { GHL_INTENT_URL_SCORECARD: "https://hook/sc" })).toBeNull();
  });
  const rowsFor = () => [
    { id: "s", dedupeKey: "scorecard:L:2026-W46", status: "pending", pipeline: "scorecard", attempts: 0, payload: { intent: "scorecard_ready" } },
    { id: "o", dedupeKey: "onboarding:A:new_client", status: "pending", pipeline: "onboarding", attempts: 0, payload: {} },
  ];
  const fakeDb = (rows: Row[], seen: { where?: any } = {}) => ({
    ghlIntent: {
      findMany: async ({ where }: any) => {
        seen.where = where;
        const startsWith = (r: Row, c: any) => r.dedupeKey.startsWith(c.dedupeKey.startsWith);
        return rows.filter((r) => (!where.OR || where.OR.some((c: any) => startsWith(r, c))) && (!where.NOT || ![].concat(where.NOT).some((c: any) => startsWith(r, c))) && (!where.id || where.id.in.includes(r.id))).map((r) => ({ id: r.id }));
      },
      findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v; return r; },
    },
  }) as any;
  const ENVB = { GHL_INTENT_URL_SCORECARD: "https://hook/sc", GHL_INTENT_URL_ONBOARDING: "https://hook/onb", INTENT_SEND_DELAY_MS: "0" };
  const post = () => vi.fn(async () => ({ ok: true, status: 200 }));

  it("SCORECARD_INTENTS=live (DUNNING shadow): sends the scorecard row, to the scorecard URL, with the stored payload", async () => {
    const rows = rowsFor(); const p = post();
    const out = await sendPendingIntents(fakeDb(rows), { deps: { post: p, env: { ...ENVB, SCORECARD_INTENTS: "live" } } });
    expect(out).toEqual({ sent: 1, failed: 0 });
    expect(p).toHaveBeenCalledWith("https://hook/sc", { intent: "scorecard_ready" });
    expect(rows[0].status).toBe("sent");
  });
  it("SCORECARD_INTENTS unset: scorecard rows are never sent even if ONBOARDING_INTENTS=live sends others", async () => {
    const rows = rowsFor(); const p = post();
    await sendPendingIntents(fakeDb(rows), { deps: { post: p, env: { ...ENVB, ONBOARDING_INTENTS: "live" } } });
    expect(rows.find((r) => r.id === "s")!.status).toBe("pending");
    expect(rows.find((r) => r.id === "o")!.status).toBe("sent");
  });
  it("nothing live → nothing sent", async () => {
    const rows = rowsFor(); const p = post();
    expect(await sendPendingIntents(fakeDb(rows), { deps: { post: p, env: ENVB } })).toEqual({ sent: 0, failed: 0 });
    expect(p).not.toHaveBeenCalled();
  });
  it("DUNNING_MODE=live without SCORECARD_INTENTS=live still excludes scorecard rows; with it, includes them", async () => {
    const seen: any = {};
    let rows = rowsFor();
    await sendPendingIntents(fakeDb(rows, seen), { deps: { post: post(), env: { ...ENVB, DUNNING_MODE: "live" } } });
    expect(rows.find((r) => r.id === "s")!.status).toBe("pending");
    expect(seen.where.NOT).toContainEqual({ dedupeKey: { startsWith: SCORECARD_DEDUPE_PREFIX } });
    rows = rowsFor();
    await sendPendingIntents(fakeDb(rows, seen), { deps: { post: post(), env: { ...ENVB, DUNNING_MODE: "live", SCORECARD_INTENTS: "live" } } });
    expect(rows.find((r) => r.id === "s")!.status).toBe("sent");
  });
});
