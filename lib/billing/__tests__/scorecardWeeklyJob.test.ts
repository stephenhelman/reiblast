import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK, runScorecardWeekly } from "../jobs/scorecardWeekly";
import { JOBS } from "../jobs";
import { JOB_NAMES, isJobName } from "../jobs/types";
import { STALE_AFTER_HOURS_BY_JOB } from "../jobHealth";
import { verifyScorecardToken } from "@/lib/scorecard/token";

type Row = Record<string, any>;
const NOW = new Date("2026-11-16T14:00:00Z"); // Monday 07:00 MST, ISO week 2026-W47
const DAY = 86_400_000;
const SECRET = "j".repeat(40);
const loc = (n: number) => `LOC${String(n).padStart(8, "0")}`;

function fakeDb(o: { stats: Row[]; accounts: Row[]; users: Row[] }) {
  const intents: Row[] = [];
  const db: any = {
    intents,
    campaignStats: {
      groupBy: async ({ where, take }: Row) => {
        const ids = [...new Set(o.stats.filter((s) => s.lastEventAt >= where.lastEventAt.gte && (!where.locationId?.gt || s.locationId > where.locationId.gt)).map((s) => s.locationId))].sort();
        return ids.slice(0, take).map((locationId) => ({ locationId }));
      },
    },
    ghlAccount: { findMany: async ({ where }: Row) => o.accounts.filter((a) => where.locationId.in.includes(a.locationId) && a.accountType === where.accountType) },
    user: { findMany: async ({ where }: Row) => o.users.filter((u) => where.ghlLocationId.in.includes(u.ghlLocationId) && u.status === where.status).map((u) => ({ ghlLocationId: u.ghlLocationId })) },
    ghlIntent: {
      // Serves both the job's dedupe lookup and sendPendingIntents' pending/failed query.
      findMany: async ({ where }: Row) =>
        where.dedupeKey?.in
          ? intents.filter((r) => where.dedupeKey.in.includes(r.dedupeKey)).map((r) => ({ dedupeKey: r.dedupeKey }))
          : intents
              .filter((r) => where.status.in.includes(r.status) && r.attempts < where.attempts.lt && (!where.id || where.id.in.includes(r.id)) && (!where.OR || where.OR.some((c: Row) => r.dedupeKey.startsWith(c.dedupeKey.startsWith))))
              .map((r) => ({ id: r.id })),
      create: async ({ data }: Row) => {
        if (intents.some((r) => r.dedupeKey === data.dedupeKey)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" });
        const r = { id: `i${intents.length + 1}`, attempts: 0, ...data };
        intents.push(r);
        return { id: r.id };
      },
      findUnique: async ({ where }: Row) => intents.find((r) => r.id === where.id || r.dedupeKey === where.dedupeKey) ?? null,
      update: async ({ where, data }: Row) => { const r = intents.find((x) => x.id === where.id)!; for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v; return r; },
    },
  };
  return db;
}
const member = (n: number, extra: Row = {}) => ({ accounts: { id: `A${n}`, locationId: loc(n), contactId: `HQCONTACT${n}`, accountType: "member", ...extra }, user: { ghlLocationId: loc(n), status: "active" }, stat: { locationId: loc(n), lastEventAt: new Date(NOW.getTime() - DAY) } });
const build = (ns: number[]) => ({ accounts: ns.map((n) => member(n).accounts), users: ns.map((n) => member(n).user), stats: ns.map((n) => member(n).stat) });
const ctx = (db: any, o: Partial<{ apply: boolean; cursor: any; shouldYield: () => boolean }> = {}) => ({ db, apply: o.apply ?? true, cursor: o.cursor ?? null, now: NOW, shouldYield: o.shouldYield ?? (() => false) });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env.SCORECARD_TOKEN_SECRET = SECRET;
  delete process.env.SCORECARD_INTENTS;
  process.env.INTENT_SEND_DELAY_MS = "0";
  process.env.GHL_INTENT_URL_SCORECARD = "https://hook/sc";
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["SCORECARD_TOKEN_SECRET", "SCORECARD_INTENTS", "INTENT_SEND_DELAY_MS", "GHL_INTENT_URL_SCORECARD", "TOOLS_SESSION_SECRET"]) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
});

describe("registration", () => {
  it("scorecard_weekly is a known job, in the JOBS map, with an ~8 day stale window", () => {
    expect(isJobName("scorecard_weekly")).toBe(true);
    expect(JOB_NAMES).toContain("scorecard_weekly");
    expect(typeof JOBS.scorecard_weekly).toBe("function");
    expect(STALE_AFTER_HOURS_BY_JOB.scorecard_weekly).toBe(8 * 24);
  });
});

describe("scorecard_weekly", () => {
  it("enqueues one intent per active member with stats activity in the last 7 days; payload carries the full, verifiable link", async () => {
    const db = fakeDb(build([1, 2]));
    const r = await runScorecardWeekly(ctx(db));
    expect(r.done).toBe(true);
    expect(db.intents).toHaveLength(2);
    const i = db.intents.find((x: Row) => x.dedupeKey === `scorecard:${loc(1)}:2026-W47`)!;
    expect(i).toMatchObject({ kind: "scorecard", pipeline: "scorecard", ghlAccountId: "A1", status: "skipped_shadow" });
    expect(Object.keys(i.payload).sort()).toEqual(["hqContactId", "intent", "scorecardUrl"]);
    expect(i.payload).toMatchObject({ intent: "scorecard_ready", hqContactId: "HQCONTACT1" });
    expect(i.payload.scorecardUrl.startsWith("https://tools.reiblast.app/scorecard/view?t=")).toBe(true);
    const token = new URL(i.payload.scorecardUrl).searchParams.get("t")!;
    expect(await verifyScorecardToken(token, { SCORECARD_TOKEN_SECRET: SECRET }, NOW)).toEqual({ ok: true, locationId: loc(1) });
    expect(r.summary).toMatchObject({ week: "2026-W47", mode: "shadow", candidates: 2, enqueued: 2 });
  });
  it("skips stale stats (older than 7 days)", async () => {
    const b = build([1, 2]);
    b.stats[1].lastEventAt = new Date(NOW.getTime() - 8 * DAY);
    const db = fakeDb(b);
    await runScorecardWeekly(ctx(db));
    expect(db.intents.map((x: Row) => x.ghlAccountId)).toEqual(["A1"]);
  });
  it("only members who pass the view page's active rule: inactive user, non-member account, missing contactId, location not owned by an active user", async () => {
    const b = build([1, 2, 3, 4, 5]);
    b.users[1].status = "paused";            // 2: inactive
    b.accounts[2].accountType = "internal";   // 3: not a member account
    b.accounts[3].contactId = "";             // 4: no HQ contact to email
    b.users[4].ghlLocationId = "SOMEOTHER";   // 5: no active user owns this location
    const db = fakeDb(b);
    const r = await runScorecardWeekly(ctx(db));
    expect(db.intents.map((x: Row) => x.ghlAccountId)).toEqual(["A1"]);
    expect(r.summary).toMatchObject({ enqueued: 1, skippedInactive: 2, skippedNotMember: 2 });
  });
  it("is idempotent within the ISO week: a second run (or duplicate trigger) enqueues nothing and keeps the stored links", async () => {
    const db = fakeDb(build([1, 2]));
    await runScorecardWeekly(ctx(db));
    const before = JSON.stringify(db.intents.map((x: Row) => x.payload));
    const r = await runScorecardWeekly(ctx(db));
    expect(db.intents).toHaveLength(2);
    expect(JSON.stringify(db.intents.map((x: Row) => x.payload))).toBe(before);
    expect(r.summary).toMatchObject({ enqueued: 0, alreadyQueued: 2 });
  });
  it("a new ISO week enqueues again", async () => {
    const b = build([1]);
    const db = fakeDb(b);
    await runScorecardWeekly(ctx(db));
    b.stats[0].lastEventAt = new Date(NOW.getTime() + 6 * DAY); // activity during the following week
    await runScorecardWeekly({ ...ctx(db), now: new Date(NOW.getTime() + 7 * DAY) } as any);
    expect(db.intents.map((x: Row) => x.dedupeKey)).toEqual([`scorecard:${loc(1)}:2026-W47`, `scorecard:${loc(1)}:2026-W48`]);
  });
  it("yields at the time budget with a cursor and resumes from it: every location exactly once, counts carried over", async () => {
    const ns = Array.from({ length: CHUNK + 3 }, (_, i) => i + 1);
    const db = fakeDb(build(ns));
    const first = await runScorecardWeekly(ctx(db, { shouldYield: () => true }));
    expect(first.done).toBe(false);
    expect(first.cursor).toMatchObject({ after: loc(CHUNK) });
    expect(db.intents).toHaveLength(CHUNK);
    const second = await runScorecardWeekly(ctx(db, { cursor: first.cursor }));
    expect(second.done).toBe(true);
    expect(db.intents).toHaveLength(ns.length);
    expect(new Set(db.intents.map((x: Row) => x.dedupeKey)).size).toBe(ns.length);
    expect(second.summary).toMatchObject({ candidates: ns.length, enqueued: ns.length });
  });
  it("dry-run writes nothing (and mints no tokens)", async () => {
    const db = fakeDb(build([1, 2]));
    const r = await runScorecardWeekly(ctx(db, { apply: false }));
    expect(db.intents).toHaveLength(0);
    expect(r.summary).toMatchObject({ dryRun: true, enqueued: 2 });
  });
  it("fails loudly when SCORECARD_TOKEN_SECRET is missing, short, or equal to the tools secret — and writes nothing", async () => {
    const db = fakeDb(build([1]));
    delete process.env.SCORECARD_TOKEN_SECRET;
    await expect(runScorecardWeekly(ctx(db))).rejects.toThrow(/SCORECARD_TOKEN_SECRET/);
    process.env.SCORECARD_TOKEN_SECRET = "short";
    await expect(runScorecardWeekly(ctx(db))).rejects.toThrow(/at least 32/);
    process.env.SCORECARD_TOKEN_SECRET = SECRET;
    process.env.TOOLS_SESSION_SECRET = SECRET;
    await expect(runScorecardWeekly(ctx(db))).rejects.toThrow(/TOOLS_SESSION_SECRET/);
    expect(db.intents).toHaveLength(0);
  });
  it("SCORECARD_INTENTS=live: rows are pending → sent immediately to the scorecard workflow URL with the stored payload", async () => {
    process.env.SCORECARD_INTENTS = "live";
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const db = fakeDb(build([1, 2]));
    const r = await runScorecardWeekly(ctx(db));
    expect(r.summary).toMatchObject({ mode: "live", enqueued: 2, sent: 2, sendFailed: 0 });
    expect(db.intents.every((x: Row) => x.status === "sent")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("https://hook/sc");
    expect(JSON.parse(init.body)).toMatchObject({ intent: "scorecard_ready", hqContactId: "HQCONTACT1" });
  });
  it("live but the workflow URL is unset or the POST fails: rows stay failed for the replay job to retry; the job still finishes", async () => {
    process.env.SCORECARD_INTENTS = "live";
    delete process.env.GHL_INTENT_URL_SCORECARD;
    const db = fakeDb(build([1]));
    const r = await runScorecardWeekly(ctx(db));
    expect(r.done).toBe(true);
    expect(r.summary).toMatchObject({ enqueued: 1, sent: 0, sendFailed: 1 });
    expect(db.intents[0].status).toBe("failed");
  });
  it("shadow mode never calls fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await runScorecardWeekly(ctx(fakeDb(build([1]))));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
