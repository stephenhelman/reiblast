import { afterEach, describe, expect, it, vi } from "vitest";
import { isDiscordWebhookUrl, resolveChannelFrom, sendDiscordWebhook, sendOpsAlert } from "../webhook";

const GOOD = "https://discord.com/api/webhooks/123/abc-DEF_1";
const map = (o: object) => JSON.stringify(o);
afterEach(() => vi.unstubAllGlobals());

describe("resolveChannelFrom", () => {
  it("resolves each key from the map (discord.com and discordapp.com)", () => {
    const raw = map({ promo: GOOD, announcements: "https://discordapp.com/api/webhooks/9/z", ops: GOOD });
    expect(resolveChannelFrom(raw, "promo")).toEqual({ ok: true, url: GOOD });
    expect(resolveChannelFrom(raw, "announcements")).toMatchObject({ ok: true });
  });
  it("reports unset, invalid JSON, non-object, missing key, bad URL", () => {
    expect(resolveChannelFrom(undefined, "promo")).toEqual({ ok: false, reason: "webhooks_not_configured" });
    expect(resolveChannelFrom("{nope", "promo")).toEqual({ ok: false, reason: "webhooks_invalid_json" });
    expect(resolveChannelFrom("[1]", "promo")).toEqual({ ok: false, reason: "webhooks_invalid_json" });
    expect(resolveChannelFrom(map({ promo: GOOD }), "announcements")).toEqual({ ok: false, reason: "webhook_missing" });
    for (const bad of ["http://discord.com/api/webhooks/1/a", "https://evil.test/api/webhooks/1/a", "https://discord.com/other", "https://discord.com.evil.test/api/webhooks/1/a", "https://u:p@discord.com/api/webhooks/1/a", 5]) {
      expect(resolveChannelFrom(map({ promo: bad }), "promo")).toEqual({ ok: false, reason: "webhook_url_invalid" });
    }
    expect(isDiscordWebhookUrl(GOOD)).toBe(true);
  });
});

describe("sendDiscordWebhook", () => {
  it("POSTs with wait=true and returns the message id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await sendDiscordWebhook(GOOD, { content: "hi" })).toEqual({ ok: true, messageId: "m1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GOOD}?wait=true`);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns fixed error codes without leaking the URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret body", { status: 429 })));
    expect(await sendDiscordWebhook(GOOD, {})).toEqual({ ok: false, error: "http_429" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`failed ${GOOD}`); }));
    expect(await sendDiscordWebhook(GOOD, {})).toEqual({ ok: false, error: "network" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect(await sendDiscordWebhook(GOOD, {})).toEqual({ ok: false, error: "bad_response" });
  });
});

describe("sendOpsAlert", () => {
  it("posts plain text to ops, and is a no-op without an ops key", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await sendOpsAlert("boom", map({ promo: GOOD }));
    expect(f).not.toHaveBeenCalled();
    await sendOpsAlert("boom", map({ ops: GOOD }));
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ content: "boom" });
  });
});
