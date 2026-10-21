import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Nothing here touches Neon: the DB client is an in-memory stand-in whose deleteMany mimics Prisma (count of rows removed).
const D1 = "111111111111111111";
const D2 = "222222222222222222";
const SECRET = "test-secret-value";
const links: any[] = [];
const outboxWrites = vi.fn();
const db = {
  discordLink: { deleteMany: vi.fn(async ({ where }: any) => {
    const keep = links.filter((l) => l.discordUserId !== where.discordUserId);
    const count = links.length - keep.length;
    links.splice(0, links.length, ...keep);
    return { count };
  }) },
  discordRevokeOutbox: { upsert: outboxWrites, create: outboxWrites, updateMany: outboxWrites },
  $transaction: vi.fn(),
};
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => db }));

import { POST } from "@/app/api/discord/unlink/route";

const call = (body: unknown, headers: Record<string, string> = { "x-reiblast-discord-secret": SECRET }, raw?: string) =>
  POST(new NextRequest("http://localhost/api/discord/unlink", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) }));
const out = async (res: Response) => ({ status: res.status, body: await res.json() });
const logged = () => [...(console.log as any).mock.calls, ...(console.error as any).mock.calls, ...(console.warn as any).mock.calls].flat().map(String).join("\n");

beforeEach(() => {
  process.env.DISCORD_BOT_INBOUND_SECRET = SECRET;
  links.length = 0;
  links.push({ id: "L1", ghlAccountId: "A1", discordUserId: D1 }, { id: "L2", ghlAccountId: "A2", discordUserId: D2 });
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/discord/unlink", () => {
  it("unlinked: deletes that Discord account's link only, answers 200, and queues no revoke", async () => {
    expect(await out(await call({ discordUserId: D1 }))).toEqual({ status: 200, body: { result: "unlinked", reason: "unlinked" } });
    expect(links.map((l) => l.discordUserId)).toEqual([D2]);
    expect(outboxWrites).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("not_linked: no link for that id, 200, nothing else touched", async () => {
    expect(await out(await call({ discordUserId: "333333333333333333" }))).toEqual({ status: 200, body: { result: "not_linked", reason: "not_linked" } });
    expect(links).toHaveLength(2);
  });

  it("idempotent: a repeat is not_linked, never an error", async () => {
    expect((await out(await call({ discordUserId: D1 }))).body.result).toBe("unlinked");
    expect(await out(await call({ discordUserId: D1 }))).toEqual({ status: 200, body: { result: "not_linked", reason: "not_linked" } });
    expect(links).toHaveLength(1);
  });

  it("ignores extra keys", async () => {
    expect((await out(await call({ discordUserId: D1, email: "x@example.test" }))).body.result).toBe("unlinked");
  });

  it.each([
    ["no secret", {}, "auth_missing"],
    ["wrong secret", { "x-reiblast-discord-secret": "nope" }, "auth_failed"],
  ])("%s → 200 error %s, nothing deleted", async (_n, headers, reason) => {
    expect(await out(await call({ discordUserId: D1 }, headers))).toEqual({ status: 200, body: { result: "error", reason } });
    expect(db.discordLink.deleteMany).not.toHaveBeenCalled();
    expect(links).toHaveLength(2);
  });

  it("server secret unset → server_misconfigured", async () => {
    delete process.env.DISCORD_BOT_INBOUND_SECRET;
    expect((await out(await call({ discordUserId: D1 }))).body).toEqual({ result: "error", reason: "server_misconfigured" });
  });

  it.each([
    ["missing id", {}],
    ["number id", { discordUserId: 111111111111111111 }],
    ["too short", { discordUserId: "123" }],
    ["non-digits", { discordUserId: "11111111111111111a" }],
    ["too long", { discordUserId: "1".repeat(26) }],
    ["empty", { discordUserId: "" }],
    ["object id (injection shape)", { discordUserId: { not: "" } }],
  ])("bad body (%s) → 200 bad_request, nothing deleted", async (_n, body) => {
    expect(await out(await call(body))).toEqual({ status: 200, body: { result: "error", reason: "bad_request" } });
    expect(db.discordLink.deleteMany).not.toHaveBeenCalled();
  });

  it.each([["not JSON", "{nope"], ["array", "[]"], ["string", '"x"']])("%s body → bad_json", async (_n, raw) => {
    expect((await out(await call(undefined, undefined, raw))).body).toEqual({ result: "error", reason: "bad_json" });
  });

  it("a DB failure → 200 internal_error with no detail in the response", async () => {
    db.discordLink.deleteMany.mockRejectedValueOnce(new Error(`db down for ${D1}`));
    expect(await out(await call({ discordUserId: D1 }))).toEqual({ status: 200, body: { result: "error", reason: "internal_error" } });
  });

  it("logs carry reason codes only — no Discord id, no secret", async () => {
    await call({ discordUserId: D1 });
    await call({ discordUserId: D1 });
    await call({ discordUserId: D1 }, { "x-reiblast-discord-secret": "wrong-secret-xyz" });
    await call({ discordUserId: "bad" });
    await call(undefined, undefined, "{nope");
    const out = logged();
    expect(out).toContain("[discord/unlink] reason=unlinked");
    expect(out).toContain("[discord/unlink] reason=not_linked");
    for (const s of [D1, D2, SECRET, "wrong-secret-xyz"]) expect(out).not.toContain(s);
  });
});
