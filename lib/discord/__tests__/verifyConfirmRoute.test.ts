import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Nothing here touches GHL, Neon or a phone: the DB client and the OTP check are mocked.
const verifyOtp = vi.fn(async (_p: unknown) => ({ status: "success" as const }) as any);
const links: any[] = [];
const attempts: any[] = [];
const account = { id: "A1", contactId: "CONTACT1abcd", accountType: "member", locationId: null, user: { id: "U1", status: "active", otpLastSentAt: null, ghlLocationId: null } };
const discordLink = {
  findFirst: vi.fn(async () => links[0] ?? null),
  create: vi.fn(async ({ data }: any) => void links.push(data)),
};
const db = {
  ghlAccount: { findMany: vi.fn(async () => [account]) },
  discordLink,
  discordVerifyAttempt: { create: vi.fn(async ({ data }: any) => void attempts.push(data)), count: vi.fn(async () => 1), findFirst: vi.fn(async () => ({ createdAt: new Date(Date.now() - 60_000) })) },
  $transaction: vi.fn(async (fn: any) => fn({ discordLink })),
};
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => db }));
vi.mock("@/lib/otp", () => ({ verifyOtp: (p: unknown) => verifyOtp(p), mintOtp: vi.fn() }));

import { POST } from "@/app/api/discord/verify/confirm/route";

const SECRET = "test-secret-value";
const D1 = "111111111111111111";
const call = (body: unknown, headers: Record<string, string> = { "x-reiblast-discord-secret": SECRET }, raw?: string) =>
  POST(new NextRequest("http://localhost/api/discord/verify/confirm", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) }));
const good = { discordUserId: D1, email: "Member@Example.TEST", code: "654321" };

beforeEach(() => {
  process.env.DISCORD_BOT_INBOUND_SECRET = SECRET;
  links.length = 0;
  attempts.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/discord/verify/confirm", () => {
  it("always HTTP 200 with a reason: misconfigured, missing, wrong secret, bad JSON, bad request (incl. malformed code)", async () => {
    delete process.env.DISCORD_BOT_INBOUND_SECRET;
    let r = await call(good);
    expect([r.status, (await r.json()).reason]).toEqual([200, "server_misconfigured"]);
    process.env.DISCORD_BOT_INBOUND_SECRET = SECRET;
    r = await call(good, {});
    expect([r.status, (await r.json()).reason]).toEqual([200, "auth_missing"]);
    r = await call(good, { "x-reiblast-discord-secret": "nope" });
    expect([r.status, (await r.json()).reason]).toEqual([200, "auth_failed"]);
    r = await call(null, undefined, "{nope");
    expect([r.status, (await r.json()).reason]).toEqual([200, "bad_json"]);
    r = await call({ ...good, code: "12" });
    expect([r.status, (await r.json()).reason]).toEqual([200, "bad_request"]);
    expect(db.ghlAccount.findMany).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("happy path creates the link, a repeat is still linked, and a wrong code is invalid_code with attemptsRemaining", async () => {
    let r = await call(good);
    expect([r.status, await r.json()]).toEqual([200, { result: "linked", reason: "linked" }]);
    expect(links).toEqual([{ ghlAccountId: "A1", discordUserId: D1 }]);
    r = await call(good);
    expect(await r.json()).toEqual({ result: "linked", reason: "linked" });
    expect(links).toHaveLength(1);

    links.length = 0;
    verifyOtp.mockResolvedValueOnce({ status: "wrong", attemptsRemaining: 2 });
    r = await call(good);
    expect(await r.json()).toEqual({ result: "refused", reason: "invalid_code", attemptsRemaining: 2 });
  });

  it("no matching start → invalid_code without attemptsRemaining and verifyOtp is never called", async () => {
    db.discordVerifyAttempt.findFirst.mockResolvedValueOnce(null as any);
    const r = await call(good);
    expect(await r.json()).toEqual({ result: "refused", reason: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("a thrown DB error is 200 internal_error with no detail", async () => {
    db.ghlAccount.findMany.mockRejectedValueOnce(new Error("boom member@example.test"));
    const r = await call(good);
    expect([r.status, await r.json()]).toEqual([200, { result: "error", reason: "internal_error" }]);
  });

  it("logs never contain the email, Discord id, code or secret", async () => {
    await call(good);
    await call(good, { "x-reiblast-discord-secret": "wrong" });
    const logged = [console.log, console.warn, console.error].flatMap((f) => (f as any).mock.calls.flat()).join(" ");
    for (const s of ["member@example.test", D1, "654321", SECRET, "wrong"]) expect(logged.toLowerCase()).not.toContain(s.toLowerCase());
  });
});
