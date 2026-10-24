import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The pause route's existing behaviour must be byte-for-byte the same with the Discord hook in place — including when it blows up.
// Nothing here touches GHL, Neon or the bot.
const D1 = "111111111111111111";
const user = { id: "U1", email: "member@example.test", ghlLocationId: "LOC1", status: "active" };
const userUpdate = vi.fn(async (..._a: any[]) => ({}));
const findFirst = vi.fn(async (..._a: any[]): Promise<any> => user);
const pauseLocation = vi.fn(async (..._a: any[]) => {});
const getWalletBalance = vi.fn(async (..._a: any[]) => -5);
const links: any[] = [];
const outbox: any[] = [];
const billingDb: any = {
  ghlAccount: { findUnique: vi.fn(async () => ({ id: "A1" })) },
  discordLink: { findUnique: vi.fn(async () => links[0] ?? null), delete: vi.fn(async () => void links.splice(0, 1)) },
  discordRevokeOutbox: {
    findUnique: vi.fn(async () => outbox[0] ?? null),
    upsert: vi.fn(async ({ create }: any) => (outbox.length ? outbox[0] : (outbox.push({ id: "O1", status: "pending", attempts: 0, nextAttemptAt: new Date(0), ...create }), outbox[0]))),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  $transaction: vi.fn(async (fn: any) => fn(billingDb)),
};
const getBillingDb = vi.fn(async () => billingDb);

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/billing/db", () => ({ getBillingDb: () => getBillingDb() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: (...a: any[]) => findFirst(...a), update: (...a: any[]) => userUpdate(...a) } } }));
vi.mock("@/lib/ghl/client", () => ({ pauseLocation: (...a: any[]) => pauseLocation(...a), getWalletBalance: (...a: any[]) => getWalletBalance(...a) }));
vi.mock("@/lib/ghl/verifyWebhook", () => ({ verifyWebhook: (req: NextRequest) => req.headers.get("x-reiblast-secret") === "ok" }));

import { POST } from "@/app/api/webhooks/ghl/pause/route";

const call = (body: unknown, secret = "ok") =>
  POST(new NextRequest("http://localhost/api/webhooks/ghl/pause", { method: "POST", headers: { "x-reiblast-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body) }));
const snap = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  vi.clearAllMocks();
  links.length = 0;
  outbox.length = 0;
  findFirst.mockResolvedValue(user);
  getWalletBalance.mockResolvedValue(-5);
  getBillingDb.mockResolvedValue(billingDb);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("pause route + Discord revoke hook", () => {
  it("a paused member with a DiscordLink: same response, link deleted and revoke queued after the User.update", async () => {
    links.push({ id: "L1", ghlAccountId: "A1", discordUserId: D1 });
    expect(await snap(await call({ email: "Member@Example.test", tags: [] }))).toEqual({ status: 200, body: { action: "paused" } });
    expect(pauseLocation).toHaveBeenCalledWith("LOC1");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "U1" }, data: { status: "suspended" } });
    expect(billingDb.discordLink.delete).toHaveBeenCalledTimes(1);
    expect(outbox).toHaveLength(1);
    expect(userUpdate.mock.invocationCallOrder[0]).toBeLessThan(billingDb.discordLink.delete.mock.invocationCallOrder[0]);
  });

  it("a paused member with no DiscordLink: same response, nothing queued", async () => {
    expect(await snap(await call({ email: "member@example.test", tags: [] }))).toEqual({ status: 200, body: { action: "paused" } });
    expect(billingDb.discordLink.delete).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(0);
  });

  it("the hook throwing (getBillingDb rejects) leaves the response exactly the same", async () => {
    links.push({ id: "L1", ghlAccountId: "A1", discordUserId: D1 });
    getBillingDb.mockRejectedValue(new Error(`no database for ${D1}`));
    expect(await snap(await call({ email: "member@example.test", tags: [] }))).toEqual({ status: 200, body: { action: "paused" } });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const logs = [...(console.log as any).mock.calls, ...(console.error as any).mock.calls].flat().join("\n");
    expect(logs).toContain("reason=revoke_hook_failed");
    expect(logs).not.toContain(D1);
  });

  it("the hook's transaction failing leaves the response exactly the same", async () => {
    links.push({ id: "L1", ghlAccountId: "A1", discordUserId: D1 });
    billingDb.$transaction.mockRejectedValueOnce(new Error("deadlock"));
    expect(await snap(await call({ email: "member@example.test", tags: [] }))).toEqual({ status: 200, body: { action: "paused" } });
  });

  it.each([
    ["unauthorized", () => call({ email: "member@example.test" }, "bad"), { status: 401, body: { error: "Unauthorized" } }],
    ["no email", () => call({ tags: [] }), { status: 200, body: { received: true } }],
    ["unknown user", () => { findFirst.mockResolvedValue(null); return call({ email: "x@example.test" }); }, { status: 200, body: { received: true } }],
    ["already suspended", () => { findFirst.mockResolvedValue({ ...user, status: "suspended" }); return call({ email: "x@example.test" }); }, { status: 200, body: { received: true } }],
    ["billing pause, wallet not negative", () => { getWalletBalance.mockResolvedValue(0); return call({ email: "x@example.test", tags: ["payment_failed"] }); }, { status: 200, body: { action: "none" } }],
  ])("%s: unchanged response, hook never runs", async (_n, run, expected) => {
    links.push({ id: "L1", ghlAccountId: "A1", discordUserId: D1 });
    expect(await snap(await run())).toEqual(expected);
    expect(getBillingDb).not.toHaveBeenCalled();
    expect(billingDb.discordLink.delete).not.toHaveBeenCalled();
  });
});
