import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscordOutbox, OUTBOX_PURGE_DAYS } from "../jobs/discordOutbox";
import { JOBS } from "../jobs";
import { JOB_NAMES } from "../jobs/types";
import { getJobHealth } from "../jobHealth";
import { MAX_EFFECT_ATTEMPTS } from "../state/effects";
import type { JobContext } from "../jobs/types";

// No Neon, no bot: in-memory outbox and a stubbed global fetch.
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/billing/db", () => ({ getBillingDb: vi.fn() }));

type Row = Record<string, any>;
const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const D = (n: number) => String(100000000000000000 + n);
const SECRET = "bot-outbound-secret-value";
const BOT_URL = "https://bot.example.test";

function fakeDb(outbox: Row[], links: Row[] = []) {
  const test = (v: any, c: any): boolean => {
    if (c && typeof c === "object" && !(c instanceof Date)) {
      if ("in" in c) return c.in.includes(v);
      if ("notIn" in c) return !c.notIn.includes(v);
      if ("not" in c) return v !== c.not;
      if ("lt" in c) return v != null && v < c.lt;
      if ("lte" in c) return v != null && v <= c.lte;
    }
    return v === c;
  };
  const match = (r: Row, w: Row) => Object.entries(w).every(([k, c]) => test(r[k], c));
  const discordRevokeOutbox = {
    findUnique: async ({ where }: Row) => outbox.find((r) => match(r, where)) ?? null,
    findMany: async ({ where, orderBy, take }: Row) =>
      outbox.filter((r) => match(r, where)).sort((a, b) => (orderBy ? a.nextAttemptAt - b.nextAttemptAt : 0)).slice(0, take ?? Infinity).map((r) => ({ id: r.id })),
    count: async ({ where }: Row) => outbox.filter((r) => match(r, where)).length,
    updateMany: async ({ where, data }: Row) => {
      const hit = outbox.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }: Row) => {
      const hit = outbox.filter((r) => match(r, where));
      hit.forEach((r) => outbox.splice(outbox.indexOf(r), 1));
      return { count: hit.length };
    },
  };
  const discordLink = { findUnique: async ({ where }: Row) => links.find((l) => match(l, where)) ?? null };
  return { db: { discordRevokeOutbox, discordLink } as any, outbox };
}

let seq = 0;
const row = (over: Row = {}) => ({ id: `O${++seq}`, discordUserId: D(seq), source: "pause_webhook", status: "pending", attempts: 0, nextAttemptAt: new Date(NOW.getTime() - 60_000), lastReason: null, completedAt: null, ...over });
const ctx = (db: any, over: Partial<JobContext> = {}): JobContext => ({ db, apply: true, cursor: null, now: NOW, shouldYield: () => false, ...over });
const reply = (result: string, reason: string) => vi.fn(async (..._a: any[]) => ({ json: async () => ({ result, reason }) }) as unknown as Response);
const logged = () => [...(console.log as any).mock.calls, ...(console.error as any).mock.calls, ...(console.warn as any).mock.calls].flat().map(String).join("\n");

let fetchMock: ReturnType<typeof reply>;
beforeEach(() => {
  seq = 0;
  process.env.DISCORD_BOT_URL = BOT_URL;
  process.env.DISCORD_BOT_OUTBOUND_SECRET = SECRET;
  fetchMock = reply("ok", "revoked");
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registration", () => {
  it("is in JOB_NAMES and JOBS, and Health lists it with a 1-hour staleness window", async () => {
    expect(JOB_NAMES).toContain("discord_outbox");
    expect(JOBS.discord_outbox).toBe(runDiscordOutbox);
    const jobRun = (job: string, ageHours: number) => ({ job, lastOkAt: new Date(NOW.getTime() - ageHours * 36e5), lastStartAt: null, lastError: null });
    const health = await getJobHealth({ jobRun: { findMany: async () => [jobRun("discord_outbox", 2), jobRun("replay", 2)] } } as any, NOW);
    expect(health.find((h) => h.job === "discord_outbox")).toMatchObject({ stale: true });
    expect(health.find((h) => h.job === "replay")).toMatchObject({ stale: false }); // nightly jobs keep 26h
    const fresh = await getJobHealth({ jobRun: { findMany: async () => [jobRun("discord_outbox", 0.5)] } } as any, NOW);
    expect(fresh.find((h) => h.job === "discord_outbox")?.stale).toBe(false);
  });
});

describe("delivery", () => {
  it("delivers due pending rows and skips rows still backing off", async () => {
    const f = fakeDb([row(), row({ nextAttemptAt: new Date(NOW.getTime() + 600_000), attempts: 1 }), row({ status: "done" })]);
    const r = await runDiscordOutbox(ctx(f.db));
    expect(r.done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.summary).toMatchObject({ delivered: 1, retried: 0, exhausted: 0, config_error: 0, superseded: 0, purged: 0 });
    expect(f.outbox.map((x) => x.status)).toEqual(["done", "pending", "done"]);
  });

  it("counts every outcome", async () => {
    const f = fakeDb([row(), row(), row(), row({ attempts: MAX_EFFECT_ATTEMPTS - 1 }), row({ discordUserId: D(900) })], [{ discordUserId: D(900) }]);
    const replies = [{ result: "ok", reason: "not_in_guild" }, { result: "error", reason: "discord_unavailable" }, { result: "error", reason: "auth_failed" }, { result: "error", reason: "internal_error" }];
    let i = 0;
    fetchMock.mockImplementation(async () => ({ json: async () => replies[i++] }) as unknown as Response);
    const r = await runDiscordOutbox(ctx(f.db));
    expect(r.summary).toMatchObject({ delivered: 1, retried: 1, config_error: 1, exhausted: 1, superseded: 1, standingExhausted: 1, standingConfigError: 1 });
  });

  it("dry-run writes nothing and sends nothing", async () => {
    const f = fakeDb([row(), row({ status: "config_error", attempts: 1 }), row({ status: "done", completedAt: new Date(NOW.getTime() - 40 * DAY) })]);
    const before = JSON.stringify(f.outbox);
    const r = await runDiscordOutbox(ctx(f.db, { apply: false }));
    expect(r.summary).toEqual({ dryRun: true, due: 1, rearmable: 1, purgeable: 1 });
    expect(JSON.stringify(f.outbox)).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("time budget and continuation", () => {
  it("yields with a cursor when the budget is spent, then a continuation finishes the rest without resending", async () => {
    const f = fakeDb(Array.from({ length: 5 }, () => row()));
    const first = await runDiscordOutbox(ctx(f.db, { shouldYield: () => fetchMock.mock.calls.length >= 2 }));
    expect(first.done).toBe(false);
    expect(first.cursor).toBeTruthy();
    expect(f.outbox.filter((x) => x.status === "done").length).toBe(fetchMock.mock.calls.length);
    const doneSoFar = fetchMock.mock.calls.length;
    const second = await runDiscordOutbox(ctx(f.db, { cursor: first.cursor ?? null }));
    expect(second.done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(doneSoFar).toBeLessThan(5);
    expect(second.summary).toMatchObject({ delivered: 5 });
  });

  it("purge and re-arm run once, on the first invocation only", async () => {
    const f = fakeDb([row(), row(), row({ status: "done", completedAt: new Date(NOW.getTime() - 40 * DAY) })]);
    const first = await runDiscordOutbox(ctx(f.db, { shouldYield: () => true }));
    expect(first.done).toBe(false);
    expect(first.cursor).toMatchObject({ prepared: true, counts: { purged: 1 } });
    f.outbox.push(row({ status: "done", completedAt: new Date(NOW.getTime() - 50 * DAY) }));
    const second = await runDiscordOutbox(ctx(f.db, { cursor: first.cursor ?? null }));
    expect(second.summary).toMatchObject({ purged: 1 }); // not re-purged on the continuation
  });
});

describe("re-arming config_error rows", () => {
  it("env present: config_error → pending → delivered", async () => {
    const f = fakeDb([row({ status: "config_error", attempts: 1, lastReason: "server_misconfigured" })]);
    const r = await runDiscordOutbox(ctx(f.db));
    expect(r.summary).toMatchObject({ rearmed: 1, delivered: 1, standingConfigError: 0 });
    expect(f.outbox[0]).toMatchObject({ status: "done", attempts: 2 });
  });

  it.each(["DISCORD_BOT_URL", "DISCORD_BOT_OUTBOUND_SECRET"])("env absent (%s unset): left alone, nothing sent", async (name) => {
    delete process.env[name];
    const f = fakeDb([row({ status: "config_error", attempts: 1 })]);
    const r = await runDiscordOutbox(ctx(f.db));
    expect(r.summary).toMatchObject({ rearmed: 0, delivered: 0, standingConfigError: 1 });
    expect(f.outbox[0]).toMatchObject({ status: "config_error", attempts: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("each re-arm is an attempt: a still-broken config (bot says auth_failed) ends exhausted at 5, then stops", async () => {
    fetchMock.mockImplementation(async () => ({ json: async () => ({ result: "error", reason: "auth_failed" }) }) as unknown as Response);
    const f = fakeDb([row()]);
    const statuses: string[] = [];
    for (let run = 1; run <= 7; run++) {
      await runDiscordOutbox(ctx(f.db));
      statuses.push(`${f.outbox[0].status}:${f.outbox[0].attempts}`);
    }
    expect(statuses).toEqual(["config_error:1", "config_error:2", "config_error:3", "config_error:4", "exhausted:5", "exhausted:5", "exhausted:5"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("purge window", () => {
  const old = (days: number, status = "done") => row({ status, completedAt: new Date(NOW.getTime() - days * DAY) });
  it(`removes done/superseded rows older than ${OUTBOX_PURGE_DAYS} days, keeps newer ones and every other status`, async () => {
    delete process.env.DISCORD_BOT_URL; // keeps the old config_error row from being re-armed and delivered
    const f = fakeDb([
      old(31), old(45, "superseded"), old(29), old(1, "superseded"),
      old(90, "exhausted"), old(90, "config_error"), row({ status: "pending", nextAttemptAt: new Date(NOW.getTime() + DAY) }),
    ]);
    const r = await runDiscordOutbox(ctx(f.db));
    expect(r.summary).toMatchObject({ purged: 2 });
    expect(f.outbox.map((x) => x.status).sort()).toEqual(["config_error", "done", "exhausted", "pending", "superseded"]);
  });
});

describe("log hygiene", () => {
  it("summary and logs hold numbers only — no Discord ids, secrets or URLs", async () => {
    fetchMock.mockImplementation(async () => { throw new Error(`net ${D(1)} ${SECRET} ${BOT_URL}`); });
    const f = fakeDb([row({ discordUserId: D(1) }), row({ discordUserId: D(2), status: "config_error", attempts: 1 })]);
    const r = await runDiscordOutbox(ctx(f.db));
    expect(Object.values(r.summary).every((v) => typeof v === "number")).toBe(true);
    const out = logged() + JSON.stringify(r);
    expect(out).toContain("[discord/outbox]");
    for (const s of [D(1), D(2), SECRET, BOT_URL, "bot.example.test"]) expect(out).not.toContain(s);
  });
});
