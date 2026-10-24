import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Nothing here may touch GHL, Neon or send a text: the DB client, the OTP sender and the contact fetch are all mocked.
const mintOtp = vi.fn(async () => ({ success: true as const }));
const fetchContactPhoneLast4 = vi.fn(async () => "4321" as string | null);
const attempts: any[] = [];
const db = {
  ghlAccount: { findMany: vi.fn(async () => [{ id: "A1", contactId: "CONTACT1abcd", accountType: "member", locationId: null, user: { id: "U1", status: "active", otpLastSentAt: null, ghlLocationId: null } }]) },
  discordLink: { findFirst: vi.fn(async () => null) },
  discordVerifyAttempt: { create: vi.fn(async ({ data }: any) => void attempts.push(data)), count: vi.fn(async () => 1) },
};
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => db }));
vi.mock("@/lib/otp", () => ({ mintOtp: (...a: unknown[]) => (mintOtp as any)(...a) }));
vi.mock("@/lib/discord/ghlContact", () => ({ fetchContactPhoneLast4: (...a: unknown[]) => (fetchContactPhoneLast4 as any)(...a) }));

import { POST } from "@/app/api/discord/verify/start/route";

const SECRET = "test-secret-value";
const D1 = "111111111111111111";
const call = (body: unknown, headers: Record<string, string> = { "x-reiblast-discord-secret": SECRET }, raw?: string) =>
  POST(new NextRequest("http://localhost/api/discord/verify/start", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) }));

beforeEach(() => {
  process.env.DISCORD_BOT_INBOUND_SECRET = SECRET;
  attempts.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/discord/verify/start", () => {
  it("always answers HTTP 200 with a reason: misconfigured, missing, wrong secret, bad JSON, bad request", async () => {
    delete process.env.DISCORD_BOT_INBOUND_SECRET;
    let r = await call({ discordUserId: D1, email: "a@b.test" });
    expect([r.status, (await r.json()).reason]).toEqual([200, "server_misconfigured"]);
    process.env.DISCORD_BOT_INBOUND_SECRET = SECRET;
    r = await call({}, {});
    expect([r.status, (await r.json()).reason]).toEqual([200, "auth_missing"]);
    r = await call({}, { "x-reiblast-discord-secret": "nope" });
    expect([r.status, (await r.json()).reason]).toEqual([200, "auth_failed"]);
    r = await call(null, undefined, "{not json");
    expect([r.status, (await r.json()).reason]).toEqual([200, "bad_json"]);
    r = await call({ discordUserId: D1 });
    expect([r.status, (await r.json()).reason]).toEqual([200, "bad_request"]);
    expect(db.ghlAccount.findMany).not.toHaveBeenCalled(); // auth/validation failures never reach the DB
    expect(mintOtp).not.toHaveBeenCalled();
  });

  it("happy path: 200 code_sent with the last 4 digits only, then the OTP is minted via the discord flow", async () => {
    const r = await call({ discordUserId: D1, email: "  Member@Example.TEST " });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ result: "code_sent", reason: "code_sent", phoneLast4: "4321" });
    expect(mintOtp).toHaveBeenCalledWith(expect.objectContaining({ flow: "discord", contactId: "CONTACT1abcd" }));
    expect(attempts.map((a) => a.kind)).toEqual(["start", "sent"]);
  });

  it("an unexpected exception is 200 internal_error with no detail in the body", async () => {
    db.ghlAccount.findMany.mockRejectedValueOnce(new Error("boom member@example.test"));
    const r = await call({ discordUserId: D1, email: "member@example.test" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ result: "error", reason: "internal_error" });
  });

  it("logs never contain the email, Discord id, phone digits or secret", async () => {
    await call({ discordUserId: D1, email: "member@example.test" });
    await call({ discordUserId: D1, email: "member@example.test" }, { "x-reiblast-discord-secret": "wrong" });
    const logged = [console.log, console.warn, console.error].flatMap((f) => (f as any).mock.calls.flat()).join(" ");
    for (const s of ["member@example.test", D1, "4321", SECRET, "wrong"]) expect(logged).not.toContain(s);
  });
});
