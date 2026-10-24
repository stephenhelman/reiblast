import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

// A database error whose message embeds the query arguments (as Prisma's can) must never reach the logs, on any Discord endpoint.
const D1 = "111111111111111111";
const EMAIL = "member@example.test";
const SECRET = "test-secret-value";

const dbError = () =>
  new Prisma.PrismaClientKnownRequestError(`Invalid \`prisma.discordLink.deleteMany()\` invocation: where: { discordUserId: "${D1}", email: "${EMAIL}" }`, { code: "P2024", clientVersion: "test" });

// Every delegate method and $transaction rejects with the Prisma-style error.
const boom = async () => {
  throw dbError();
};
const db: any = new Proxy({}, { get: (_t, prop) => (prop === "$transaction" ? boom : new Proxy({}, { get: () => boom })) });
vi.mock("@/lib/billing/db", () => ({ getBillingDb: async () => db }));
vi.mock("@/lib/otp", () => ({ mintOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/lib/discord/ghlContact", () => ({ fetchContactPhoneLast4: vi.fn(async () => "4321") }));

import { POST as verifyStart } from "@/app/api/discord/verify/start/route";
import { POST as verifyConfirm } from "@/app/api/discord/verify/confirm/route";
import { POST as unlink } from "@/app/api/discord/unlink/route";

const post = (handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  handler(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-reiblast-discord-secret": SECRET }, body: JSON.stringify(body) }));
const logged = () => [...(console.log as any).mock.calls, ...(console.error as any).mock.calls, ...(console.warn as any).mock.calls].flat().map(String).join("\n");

beforeEach(() => {
  process.env.DISCORD_BOT_INBOUND_SECRET = SECRET;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each([
  ["verify-start", verifyStart, "/api/discord/verify/start", { discordUserId: D1, email: EMAIL }, "discord/verify/start"],
  ["verify-confirm", verifyConfirm, "/api/discord/verify/confirm", { discordUserId: D1, email: EMAIL, code: "123456" }, "discord/verify/confirm"],
  ["unlink", unlink, "/api/discord/unlink", { discordUserId: D1 }, "discord/unlink"],
] as const)("%s: an unexpected database error", (_name, handler, path, body, label) => {
  it("answers 200 internal_error and logs only a fixed reason, the error class and the Prisma code", async () => {
    const res = await post(handler as any, path, body);
    expect([res.status, await res.json()]).toEqual([200, { result: "error", reason: "internal_error" }]);
    const out = logged();
    expect(out).toContain(`[${label}] internal error reason=internal_error name=PrismaClientKnownRequestError code=P2024`);
    for (const leaked of [D1, EMAIL, SECRET, "invocation", "discordUserId", "deleteMany", " at "]) expect(out, `leaked: ${leaked}`).not.toContain(leaked);
  });
});

describe("a non-Error throw", () => {
  it("is logged as a fixed reason with an unknown class, never its value", async () => {
    vi.doMock("@/lib/discord/unlink", () => ({ parseUnlink: () => ({ discordUserId: D1 }), handleUnlink: async () => { throw `string thrown with ${D1}`; } }));
    vi.resetModules();
    const { POST } = await import("@/app/api/discord/unlink/route");
    const res = await post(POST as any, "/api/discord/unlink", { discordUserId: D1 });
    expect((await res.json()).reason).toBe("internal_error");
    expect(logged()).toContain("internal error reason=internal_error name=unknown code=-");
    expect(logged()).not.toContain(D1);
    vi.doUnmock("@/lib/discord/unlink");
  });
});
