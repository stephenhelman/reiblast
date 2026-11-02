import { beforeEach, describe, expect, it, vi } from "vitest";
import { REVOKE_LEASE_MS, deliverRevoke, revokeDiscordForAccount, revokeDiscordOnPause, type RevokeDb } from "../revoke";
import { EFFECT_BACKOFF_MS, MAX_EFFECT_ATTEMPTS } from "@/lib/billing/state/effects";

// Nothing here touches Neon or the bot: the DB is an in-memory stand-in and fetch is a mock.
const waited: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void waited.push(p) }));

type Row = Record<string, any>;
const NOW = new Date("2026-10-20T12:00:00Z");
const D1 = "111111111111111111";
const SECRET = "bot-outbound-secret-value";
const BOT_URL = "https://bot.example.test";

function fakeDb(links: Row[] = [], outbox: Row[] = [], accounts: Row[] = [{ id: "A1", userId: "U1" }]) {
  let seq = 0;
  const match = (r: Row, w: Row) =>
    Object.entries(w).every(([k, c]) => {
      if (c && typeof c === "object" && "not" in c) return r[k] !== c.not;
      if (c && typeof c === "object" && "lte" in c) return r[k] <= c.lte;
      return r[k] === c;
    });
  const discordLink = {
    findUnique: async ({ where }: Row) => links.find((l) => match(l, where)) ?? null,
    delete: async ({ where }: Row) => void links.splice(links.findIndex((l) => match(l, where)), 1),
  };
  const discordRevokeOutbox = {
    findUnique: async ({ where }: Row) => outbox.find((r) => match(r, where)) ?? null,
    upsert: async ({ where, create }: Row) => {
      const found = outbox.find((x) => match(x, where));
      if (found) return { id: found.id };
      const r = { id: `O${++seq}`, status: "pending", attempts: 0, lastReason: null, completedAt: null, ...create };
      outbox.push(r);
      return { id: r.id };
    },
    updateMany: async ({ where, data }: Row) => {
      const hit = outbox.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  const ghlAccount = { findUnique: async ({ where }: Row) => accounts.find((a) => match(a, where)) ?? null };
  const db = { discordLink, discordRevokeOutbox, ghlAccount, $transaction: async (fn: any) => fn({ discordLink, discordRevokeOutbox }) };
  return { db: db as unknown as RevokeDb, links, outbox };
}

const link = (over: Row = {}) => ({ id: "L1", ghlAccountId: "A1", discordUserId: D1, ...over });
const pending = (over: Row = {}) => ({ id: "O1", discordUserId: D1, source: "pause_webhook", status: "pending", attempts: 0, nextAttemptAt: NOW, lastReason: null, completedAt: null, ...over });
const jsonRes = (body: unknown) => ({ json: async () => body }) as unknown as Response;
const botReply = (result: string, reason: string) => vi.fn(async (..._a: any[]) => jsonRes({ result, reason }));
const deps = (db: RevokeDb, f?: any) => ({ db, fetch: f as typeof fetch, now: () => NOW });
const logged = () => [...(console.log as any).mock.calls, ...(console.error as any).mock.calls, ...(console.warn as any).mock.calls].flat().map(String).join("\n");

beforeEach(() => {
  process.env.DISCORD_BOT_URL = BOT_URL;
  process.env.DISCORD_BOT_OUTBOUND_SECRET = SECRET;
  waited.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("revokeDiscordForAccount", () => {
  it("no link → no-op, no outbox row", async () => {
    const f = fakeDb([]);
    expect(await revokeDiscordForAccount("A1", "pause_webhook", deps(f.db))).toBeNull();
    expect(f.outbox).toHaveLength(0);
  });

  it("link → deleted and a pending outbox row created, returning its id", async () => {
    const f = fakeDb([link()]);
    const r = await revokeDiscordForAccount("A1", "pause_webhook", deps(f.db));
    expect(f.links).toHaveLength(0);
    expect(f.outbox).toHaveLength(1);
    expect(r).toEqual({ outboxId: f.outbox[0].id });
    expect(f.outbox[0]).toMatchObject({ discordUserId: D1, source: "pause_webhook", status: "pending", attempts: 0 });
  });

  it("an existing pending row is left untouched (attempts and backoff preserved)", async () => {
    const later = new Date(NOW.getTime() + 3_600_000);
    const f = fakeDb([link()], [pending({ attempts: 3, nextAttemptAt: later, lastReason: "timeout" })]);
    await revokeDiscordForAccount("A1", "member_removal", deps(f.db));
    expect(f.outbox).toHaveLength(1);
    expect(f.outbox[0]).toMatchObject({ attempts: 3, nextAttemptAt: later, lastReason: "timeout", source: "pause_webhook" });
  });

  it.each(["done", "superseded", "exhausted", "config_error"])("a %s row is reset to pending with attempts 0", async (status) => {
    const f = fakeDb([link()], [pending({ status, attempts: 5, lastReason: "timeout", completedAt: NOW, nextAttemptAt: null })]);
    await revokeDiscordForAccount("A1", "member_removal", deps(f.db));
    expect(f.outbox).toHaveLength(1);
    expect(f.outbox[0]).toMatchObject({ status: "pending", attempts: 0, lastReason: null, completedAt: null, nextAttemptAt: NOW, source: "member_removal" });
  });
});

describe("deliverRevoke — sending", () => {
  it("POSTs { discordUserId } only, with the secret header, a 10s timeout signal and redirect:error", async () => {
    const f = fakeDb([], [pending()]);
    const fetchMock = botReply("ok", "revoked");
    await deliverRevoke("O1", deps(f.db, fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BOT_URL}/revoke`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init.headers["x-reiblast-bot-secret"]).toBe(SECRET);
    expect(JSON.parse(init.body)).toEqual({ discordUserId: D1 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("tolerates a trailing slash on DISCORD_BOT_URL", async () => {
    process.env.DISCORD_BOT_URL = `${BOT_URL}/`;
    const f = fakeDb([], [pending()]);
    const fetchMock = botReply("ok", "revoked");
    await deliverRevoke("O1", deps(f.db, fetchMock));
    expect(fetchMock.mock.calls[0][0]).toBe(`${BOT_URL}/revoke`);
  });

  it("lease: two concurrent deliveries send once; the lease pushes nextAttemptAt out", async () => {
    const f = fakeDb([], [pending()]);
    const fetchMock = botReply("ok", "revoked");
    const [a, b] = await Promise.all([deliverRevoke("O1", deps(f.db, fetchMock)), deliverRevoke("O1", deps(f.db, fetchMock))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([a, b].sort()).toEqual(["done", "skipped"]);
  });

  it("claim sets the lease before the POST (a second claimer sees a future nextAttemptAt)", async () => {
    const f = fakeDb([], [pending()]);
    let during: Date | null = null;
    const fetchMock = vi.fn(async () => {
      during = f.outbox[0].nextAttemptAt;
      return jsonRes({ result: "ok", reason: "revoked" });
    });
    await deliverRevoke("O1", deps(f.db, fetchMock));
    expect(during).toEqual(new Date(NOW.getTime() + REVOKE_LEASE_MS));
  });

  it("not due (backing off) → skipped, no send", async () => {
    const f = fakeDb([], [pending({ nextAttemptAt: new Date(NOW.getTime() + 60_000) })]);
    const fetchMock = botReply("ok", "revoked");
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["done", "superseded", "exhausted", "config_error"])("a %s row is skipped", async (status) => {
    const f = fakeDb([], [pending({ status })]);
    const fetchMock = botReply("ok", "revoked");
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown row id → skipped", async () => {
    const f = fakeDb();
    expect(await deliverRevoke("nope", deps(f.db, botReply("ok", "revoked")))).toBe("skipped");
  });

  it("re-link: the Discord id is linked again → superseded, nothing sent", async () => {
    const f = fakeDb([link({ ghlAccountId: "A2" })], [pending()]);
    const fetchMock = botReply("ok", "revoked");
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("superseded");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.outbox[0]).toMatchObject({ status: "superseded", lastReason: "relinked", completedAt: NOW });
  });
});

describe("deliverRevoke — contract reasons", () => {
  it.each(["revoked", "not_in_guild", "not_holding_role"])("ok / %s → done", async (reason) => {
    const f = fakeDb([], [pending()]);
    expect(await deliverRevoke("O1", deps(f.db, botReply("ok", reason)))).toBe("done");
    expect(f.outbox[0]).toMatchObject({ status: "done", attempts: 1, lastReason: reason, completedAt: NOW });
  });

  it("ok with a reason this server doesn't know is still delivered (contract: result ok = delivered)", async () => {
    const f = fakeDb([], [pending()]);
    expect(await deliverRevoke("O1", deps(f.db, botReply("ok", "something_new")))).toBe("done");
    expect(f.outbox[0].lastReason).toBe("ok_other");
  });

  it.each(["discord_unavailable", "internal_error"])("error / %s → retry on the first rung of the ladder", async (reason) => {
    const f = fakeDb([], [pending()]);
    expect(await deliverRevoke("O1", deps(f.db, botReply("error", reason)))).toBe("retry");
    expect(f.outbox[0]).toMatchObject({ status: "pending", attempts: 1, lastReason: reason });
    expect(f.outbox[0].nextAttemptAt).toEqual(new Date(NOW.getTime() + EFFECT_BACKOFF_MS[0]));
  });

  it.each(["auth_missing", "auth_failed", "bad_json", "bad_request"])("error / %s → config_error, no retry", async (reason) => {
    const f = fakeDb([], [pending()]);
    expect(await deliverRevoke("O1", deps(f.db, botReply("error", reason)))).toBe("config_error");
    expect(f.outbox[0]).toMatchObject({ status: "config_error", attempts: 1, lastReason: reason });
    expect(console.error).toHaveBeenCalled();
  });

  it("an unknown error reason is retried", async () => {
    const f = fakeDb([], [pending()]);
    expect(await deliverRevoke("O1", deps(f.db, botReply("error", "brand_new")))).toBe("retry");
    expect(f.outbox[0]).toMatchObject({ status: "pending", lastReason: "unknown_response" });
  });

  it("walks the effects.ts ladder and is exhausted on the 5th failed attempt", async () => {
    const f = fakeDb([], [pending()]);
    const fetchMock = botReply("error", "discord_unavailable");
    for (let n = 1; n < MAX_EFFECT_ATTEMPTS; n++) {
      expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("retry");
      expect(f.outbox[0].nextAttemptAt).toEqual(new Date(NOW.getTime() + EFFECT_BACKOFF_MS[n - 1]));
      f.outbox[0].nextAttemptAt = NOW; // time passes
    }
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("exhausted");
    expect(f.outbox[0]).toMatchObject({ status: "exhausted", attempts: MAX_EFFECT_ATTEMPTS, lastReason: "discord_unavailable" });
    expect(console.error).toHaveBeenCalled();
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("skipped");
  });
});

describe("deliverRevoke — transport failures retry", () => {
  const expectRetry = async (fetchMock: any, reason: string) => {
    const f = fakeDb([], [pending()]);
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("retry");
    expect(f.outbox[0]).toMatchObject({ status: "pending", attempts: 1, lastReason: reason });
  };
  it("timeout", () => expectRetry(vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }), "timeout"));
  it("network error / redirect refusal", () => expectRetry(vi.fn(async () => { throw new TypeError("fetch failed"); }), "network_error"));
  it("an HTML 502 body from the host's proxy (HTTP status is never consulted)", () =>
    expectRetry(vi.fn(async () => ({ status: 502, ok: false, json: async () => { throw new SyntaxError("Unexpected token <"); } }) as unknown as Response), "bad_response"));
  it("a non-JSON body on a 200", () =>
    expectRetry(vi.fn(async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("bad"); } }) as unknown as Response), "bad_response"));
  it.each([null, "ok", [], {}, { result: "ok" }, { reason: "revoked" }, { result: 1, reason: "revoked" }, { result: "maybe", reason: "x" }])("unparseable shape %j", (body) =>
    expectRetry(vi.fn(async () => jsonRes(body)), "bad_response"));
  it("a 200 ok body is delivered even if the HTTP status says otherwise", async () => {
    const f = fakeDb([], [pending()]);
    const res = { status: 500, ok: false, json: async () => ({ result: "ok", reason: "revoked" }) } as unknown as Response;
    expect(await deliverRevoke("O1", deps(f.db, vi.fn(async () => res)))).toBe("done");
  });
});

describe("deliverRevoke — config and containment", () => {
  it.each(["DISCORD_BOT_URL", "DISCORD_BOT_OUTBOUND_SECRET"])("missing %s → config_error, row kept, nothing sent", async (name) => {
    delete process.env[name];
    const f = fakeDb([], [pending()]);
    const fetchMock = botReply("ok", "revoked");
    expect(await deliverRevoke("O1", deps(f.db, fetchMock))).toBe("config_error");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.outbox).toHaveLength(1);
    expect(f.outbox[0]).toMatchObject({ status: "config_error", lastReason: "server_misconfigured" });
  });

  it("a DB failure is contained (returns error, never throws)", async () => {
    const f = fakeDb([], [pending()]);
    (f.db as any).discordRevokeOutbox.findUnique = async () => { throw new Error(`boom ${D1} ${SECRET}`); };
    expect(await deliverRevoke("O1", deps(f.db, botReply("ok", "revoked")))).toBe("error");
  });

  it("logs carry no Discord id, secret or bot URL — across success, failure and DB-error paths", async () => {
    for (const reply of [botReply("ok", "revoked"), botReply("error", "auth_failed"), botReply("error", "discord_unavailable"), vi.fn(async () => { throw new Error(`net ${D1} ${SECRET} ${BOT_URL}`); })]) {
      const f = fakeDb([], [pending()]);
      await deliverRevoke("O1", deps(f.db, reply));
    }
    const f = fakeDb([link({ ghlAccountId: "A2" })], [pending()]);
    await deliverRevoke("O1", deps(f.db, botReply("ok", "revoked"))); // superseded path
    const bad = fakeDb([], [pending()]);
    (bad.db as any).discordRevokeOutbox.findUnique = async () => { throw new Error(`boom ${D1} ${SECRET}`); };
    await deliverRevoke("O1", deps(bad.db));
    const out = logged();
    expect(out).toContain("[discord/revoke]");
    for (const secretish of [D1, SECRET, BOT_URL, "bot.example.test"]) expect(out).not.toContain(secretish);
  });
});

describe("revokeDiscordOnPause", () => {
  it("no GhlAccount → no-op", async () => {
    const f = fakeDb([link()], [], []);
    await revokeDiscordOnPause("U1", deps(f.db));
    expect(f.links).toHaveLength(1);
    expect(waited).toHaveLength(0);
  });

  it("no DiscordLink → no-op, nothing scheduled", async () => {
    const f = fakeDb([]);
    await revokeDiscordOnPause("U1", deps(f.db));
    expect(f.outbox).toHaveLength(0);
    expect(waited).toHaveLength(0);
  });

  it("link → revoked in the transaction, delivery scheduled via waitUntil and reaches the bot", async () => {
    const f = fakeDb([link()]);
    const fetchMock = botReply("ok", "revoked");
    await revokeDiscordOnPause("U1", deps(f.db, fetchMock));
    expect(f.links).toHaveLength(0);
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(f.outbox[0].status).toBe("done");
  });

  it("any failure is swallowed and logged as a fixed reason code, with no ids", async () => {
    const f = fakeDb([link()]);
    (f.db as any).$transaction = async () => { throw Object.assign(new Error(`tx failed for ${D1}`), { code: "P2034" }); };
    await expect(revokeDiscordOnPause("U1", deps(f.db))).resolves.toBeUndefined();
    expect(logged()).toContain("reason=revoke_hook_failed");
    expect(logged()).not.toContain(D1);
    expect(waited).toHaveLength(0);
  });
});

describe("revokeDiscordForEngine (the saas_pause hook)", () => {
  it("queues the revoke for a linked account and delivers it now (awaited); a second call is a no-op", async () => {
    const { revokeDiscordForEngine } = await import("../revoke");
    const { db, links, outbox } = fakeDb([link()]);
    const f = botReply("ok", "revoked");
    await revokeDiscordForEngine("A1", deps(db, f));
    expect(links).toHaveLength(0);
    expect(outbox[0]).toMatchObject({ discordUserId: D1, source: "dunning_engine", status: "done" });
    expect(f).toHaveBeenCalledTimes(1);
    await revokeDiscordForEngine("A1", deps(db, f)); // idempotent: no link left, nothing queued, no second POST
    expect(outbox).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("no DiscordLink → nothing happens", async () => {
    const { revokeDiscordForEngine } = await import("../revoke");
    const { db, outbox } = fakeDb([]);
    const f = botReply("ok", "revoked");
    await revokeDiscordForEngine("A1", deps(db, f));
    expect(outbox).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });
  it("a bot outage does not throw: the row stays pending for the discord_outbox job's retries", async () => {
    const { revokeDiscordForEngine } = await import("../revoke");
    const { db, outbox } = fakeDb([link()]);
    await revokeDiscordForEngine("A1", deps(db, botReply("error", "discord_unavailable")));
    expect(outbox[0]).toMatchObject({ status: "pending", attempts: 1, lastReason: "discord_unavailable" });
  });
});
