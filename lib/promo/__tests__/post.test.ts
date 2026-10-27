import { describe, expect, it, vi } from "vitest";
import { pickVariation, postOnce, previousSentVariation } from "../post";
import { fakePromoDb } from "./fakeDb";

const base = (db: ReturnType<typeof fakePromoDb>["db"], send: any, extra: object = {}) => ({
  db, promo: "founders-2026", runKey: "2026-10-25T16", channel: "promo" as const, webhookUrl: "https://discord.com/api/webhooks/1/a",
  chooseVariation: async () => 2, build: (v: number) => ({ content: `v${v}` }), send, alert: vi.fn(async () => {}), ...extra,
});

describe("pickVariation", () => {
  it("never repeats the previous variation, over the whole random range", () => {
    for (const prev of [null, 1, 2, 3, 4]) {
      for (let i = 0; i <= 100; i++) {
        const v = pickVariation(prev, () => i / 100 - (i === 100 ? 1e-9 : 0));
        expect([1, 2, 3, 4]).toContain(v);
        expect(v).not.toBe(prev);
      }
    }
  });
  it("covers all 4 when there is no previous", () => {
    const seen = new Set([0, 0.3, 0.6, 0.99].map((r) => pickVariation(null, () => r)));
    expect(seen.size).toBe(4);
  });
});

describe("previousSentVariation", () => {
  it("uses the latest sent non-launch row; ignores failed rows and the launch post", async () => {
    const { db } = fakePromoDb([
      { runKey: "a", variation: 1, status: "sent" },
      { runKey: "b", variation: 3, status: "sent" },
      { runKey: "c", variation: 4, status: "failed" },
      { runKey: "launch", variation: 0, status: "sent" },
    ]);
    expect(await previousSentVariation(db, "founders-2026")).toBe(3);
    expect(await previousSentVariation(db, "other")).toBeNull();
  });
});

describe("postOnce", () => {
  it("inserts, sends, and marks the row sent with the message id", async () => {
    const { db, table } = fakePromoDb();
    const send = vi.fn(async () => ({ ok: true as const, messageId: "m1" }));
    expect(await postOnce(base(db, send))).toEqual({ reason: "posted", messageId: "m1" });
    expect(send).toHaveBeenCalledWith(expect.any(String), { content: "v2" });
    expect(table[0]).toMatchObject({ runKey: "2026-10-25T16", variation: 2, status: "sent", discordMessageId: "m1", error: null });
  });
  it("skips as duplicate when a sent row exists (no send)", async () => {
    const { db } = fakePromoDb([{ runKey: "2026-10-25T16", status: "sent" }]);
    const send = vi.fn();
    expect(await postOnce(base(db, send))).toEqual({ reason: "duplicate" });
    expect(send).not.toHaveBeenCalled();
  });
  it("records a failure, alerts ops, then retries the failed row with its own variation", async () => {
    const { db, table } = fakePromoDb();
    const alert = vi.fn(async (_t: string) => {});
    const fail = vi.fn(async () => ({ ok: false as const, error: "http_500" }));
    expect(await postOnce(base(db, fail, { alert }))).toEqual({ reason: "send_failed", error: "http_500" });
    expect(table[0]).toMatchObject({ status: "failed", error: "http_500" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).not.toMatch(/https?:/);

    const ok = vi.fn(async () => ({ ok: true as const, messageId: "m2" }));
    const choose = vi.fn(async () => 4);
    expect(await postOnce(base(db, ok, { chooseVariation: choose }))).toEqual({ reason: "posted", messageId: "m2" });
    expect(table).toHaveLength(1); // updated, not a second row
    expect(table[0]).toMatchObject({ status: "sent", variation: 2 });
    expect(choose).not.toHaveBeenCalled();
    expect(ok).toHaveBeenCalledWith(expect.any(String), { content: "v2" });
  });
  it("treats a lost insert race (unique violation) as duplicate", async () => {
    const { db } = fakePromoDb();
    db.promoPost.create = async () => { throw Object.assign(new Error("x"), { code: "P2002" }); };
    expect(await postOnce(base(db, vi.fn()))).toEqual({ reason: "duplicate" });
  });
});
