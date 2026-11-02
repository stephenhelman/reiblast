import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakePromoDb } from "./fakeDb";

// Nothing here touches Neon or Discord: Prisma is an in-memory stand-in and fetch is a mock.
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => state.db[k as string] }) }));

import { POST } from "@/app/api/webhooks/ghl-promo/route";

const PROMO_URL = "https://discord.com/api/webhooks/1/promo-token";
const ANN_URL = "https://discord.com/api/webhooks/2/ann-token";
const OPS_URL = "https://discord.com/api/webhooks/3/ops-token";
const MAP = JSON.stringify({ promo: PROMO_URL, announcements: ANN_URL, ops: OPS_URL });
const SECRET = "promo-secret-value";
let fetchMock: ReturnType<typeof vi.fn>;
let table: ReturnType<typeof fakePromoDb>["table"];

const call = async (body: unknown, secret: string | null = SECRET) => {
  const req = new NextRequest("http://localhost/api/webhooks/ghl-promo", {
    method: "POST",
    headers: secret ? { "x-reiblast-promo-secret": secret } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  return res.json();
};
const urlsCalled = () => fetchMock.mock.calls.map((c) => String(c[0]).split("?")[0]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T21:30:00Z")); // pre-launch
  process.env.GHL_PROMO_SECRET = SECRET;
  process.env.DISCORD_PROMO_WEBHOOKS = MAP;
  process.env.FOUNDER_CLAIMS_OPEN_AT = "2026-10-29T00:00:00Z";
  process.env.FOUNDER_CLAIMS_CLOSE_AT = "2026-11-01T04:59:59Z";
  delete process.env.DISCORD_REIBLAST_ROLE_ID;
  let n = 0;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: `msg${++n}` }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const f = fakePromoDb();
  // founderClaim/$queryRaw: the live slot count (getFounderSlotsLeft) reads an empty claims table at the test clock.
  state.db = f.db.promoPost ? { promoPost: f.db.promoPost, founderClaim: { findMany: async () => [] }, $queryRaw: async () => [{ now: new Date() }] } : null;
  table = f.table;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tick = { promo: "founders-2026", event: "discord_tick" };
const launch = { promo: "founders-2026", event: "discord_launch" };

describe("auth and dispatch", () => {
  it("answers 200 with a reason for missing / wrong secret, misconfigured, bad json, unknown event", async () => {
    expect((await call(tick, null)).reason).toBe("auth_missing");
    expect((await call(tick, "wrong")).reason).toBe("auth_failed");
    expect((await call("{nope")).reason).toBe("bad_json");
    expect((await call({ promo: "founders-2026", event: "nope" })).reason).toBe("unknown_event");
    expect((await call({ promo: "other", event: "discord_tick" })).reason).toBe("unknown_event");
    expect((await call({ promo: "__proto__", event: "constructor" })).reason).toBe("unknown_event");
    delete process.env.GHL_PROMO_SECRET;
    expect((await call(tick)).reason).toBe("server_misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("discord_tick", () => {
  it("posts the pre-launch rotation to the promo channel only, and writes a sent row keyed by CT hour", async () => {
    const out = await call(tick);
    expect(out).toMatchObject({ reason: "posted", channel: "promo", runKey: "2026-10-25T16" });
    expect(urlsCalled()).toEqual([PROMO_URL]);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ status: "sent", discordMessageId: "msg1" });
    expect(JSON.stringify(out)).not.toContain("token");
  });
  it("skips the same hour as duplicate, but posts the next hour with a different variation", async () => {
    await call(tick);
    expect((await call(tick)).reason).toBe("duplicate");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = table[0].variation;
    vi.setSystemTime(new Date("2026-10-25T22:30:00Z"));
    expect((await call(tick)).reason).toBe("posted");
    expect(table).toHaveLength(2);
    expect(table[1].variation).not.toBe(first);
  });
  it("uses the claims-open set after open and posts nothing after close", async () => {
    vi.setSystemTime(new Date("2026-10-29T01:00:00Z"));
    const out = await call({ ...tick, dryRun: "true" });
    expect(JSON.stringify(out.payload)).toContain("of 10");
    vi.setSystemTime(new Date("2026-11-01T04:59:59Z"));
    expect((await call(tick)).reason).toBe("offer_closed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("posts nothing when the clock env is missing or invalid", async () => {
    process.env.FOUNDER_CLAIMS_CLOSE_AT = "garbage";
    expect((await call(tick)).reason).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries a failed row once the webhook recovers, and alerts ops on the failure", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 500 })).mockImplementationOnce(async () => new Response("{}", { status: 204 }));
    expect(await call(tick)).toMatchObject({ reason: "send_failed", error: "http_500" });
    expect(urlsCalled()).toEqual([PROMO_URL, OPS_URL]);
    expect(table[0].status).toBe("failed");
    expect((await call(tick)).reason).toBe("posted");
    expect(table).toHaveLength(1);
    expect(table[0].status).toBe("sent");
  });
});

describe("discord_launch", () => {
  it("posts to announcements only inside the window, with the role ping when configured", async () => {
    process.env.DISCORD_REIBLAST_ROLE_ID = "123456789012345678";
    expect((await call(launch)).reason).toBe("launch_not_open");
    vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
    expect(await call(launch)).toMatchObject({ reason: "posted", channel: "announcements", runKey: "launch" });
    expect(urlsCalled()).toEqual([ANN_URL]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.content).toContain("<@&123456789012345678>");
    expect(body.allowed_mentions).toEqual({ roles: ["123456789012345678"] });
    expect((await call(launch)).reason).toBe("duplicate");
    vi.setSystemTime(new Date("2026-11-01T04:59:59Z"));
    expect((await call(launch)).reason).toBe("offer_closed");
  });
  it("omits the ping without a role id", async () => {
    vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
    await call(launch);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.content).toBeUndefined();
    expect(body.allowed_mentions).toBeUndefined();
  });
});

describe("webhook map problems post nothing", () => {
  it.each([
    ["unset", undefined, "webhooks_not_configured"],
    ["invalid json", "{bad", "webhooks_invalid_json"],
    ["missing key", JSON.stringify({ announcements: ANN_URL }), "webhook_missing"],
    ["bad url", JSON.stringify({ promo: "https://evil.test/api/webhooks/1/a" }), "webhook_url_invalid"],
  ])("%s", async (_n, raw, reason) => {
    if (raw === undefined) delete process.env.DISCORD_PROMO_WEBHOOKS;
    else process.env.DISCORD_PROMO_WEBHOOKS = raw;
    const out = await call(tick);
    expect(out.reason).toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(table).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain("evil");
  });
});

describe("dryRun", () => {
  it("returns payload + channel key, sends nothing, writes nothing", async () => {
    const t = await call({ ...tick, dryRun: "true" });
    expect(t).toMatchObject({ reason: "dry_run", channel: "promo" });
    expect(t.payload.embeds).toHaveLength(1);
    expect(t.limitViolations).toEqual([]);
    const l = await call({ ...launch, dryRun: "true" });
    expect(l).toMatchObject({ reason: "dry_run", channel: "announcements", wouldPost: false });
    expect(JSON.stringify([t, l])).not.toContain("token");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(table).toHaveLength(0);
  });
  it("only an exact string \"true\" enables dryRun", async () => {
    expect((await call({ ...tick, dryRun: true })).reason).toBe("posted");
  });
});
