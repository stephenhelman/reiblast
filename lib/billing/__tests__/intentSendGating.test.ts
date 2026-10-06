import { describe, expect, it, vi } from "vitest";
import { enqueueAndSendOnboardingIntent } from "../onboardingIntents";
import { sendPendingIntents } from "../intents/send";

type Row = Record<string, any>;

function makeDb(rows: Row[]) {
  const matches = (r: Row, w: any): boolean =>
    (!w.status || w.status.in.includes(r.status)) &&
    (!w.attempts || r.attempts < w.attempts.lt) &&
    (!w.id || w.id.in.includes(r.id)) &&
    (!w.OR || w.OR.some((c: any) => r.dedupeKey.startsWith(c.dedupeKey.startsWith)));
  const db: any = {
    rows,
    ghlIntent: {
      findMany: async ({ where }: any) => rows.filter((r) => matches(r, where)).map((r) => ({ id: r.id })),
      findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.dedupeKey === where.dedupeKey) ?? null,
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v;
        return r;
      },
      create: async ({ data }: any) => {
        const r = { id: `n${rows.length + 1}`, attempts: 0, ...data };
        rows.push(r);
        return r;
      },
    },
  };
  return db;
}

const row = (id: string, dedupeKey: string, status = "pending", pipeline = "onboarding"): Row => ({ id, dedupeKey, status, pipeline, attempts: 0, payload: { contactId: "C" } });
const URLS = { GHL_INTENT_URL_ONBOARDING: "https://hook/onb", GHL_INTENT_URL_ACTIVE_CLIENT: "https://hook/ac" };
const ok = () => vi.fn(async () => ({ ok: true, status: 200 }));

describe("sendPendingIntents gating", () => {
  it("DUNNING_MODE=shadow + ONBOARDING_INTENTS=live: sends a pending onboarding intent, leaves shadow: and handoff: rows", async () => {
    const db = makeDb([row("o", "onboarding:A1:new_client"), row("s", "shadow:A1:t:stage:paid", "pending", "active_client"), row("h", "handoff:A1", "pending", "active_client")]);
    const post = ok();
    const r = await sendPendingIntents(db, { deps: { post, env: { ...URLS, DUNNING_MODE: "shadow", ONBOARDING_INTENTS: "live" } } });
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(db.rows.map((x: Row) => x.status)).toEqual(["sent", "pending", "pending"]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("retries a failed onboarding intent", async () => {
    const db = makeDb([{ ...row("o", "onboarding:A1:new_client", "failed"), attempts: 1 }]);
    const r = await sendPendingIntents(db, { deps: { post: ok(), env: { ...URLS, ONBOARDING_INTENTS: "live" } } });
    expect(r.sent).toBe(1);
  });

  it("handoff intents follow CLIENT_HANDOFF only", async () => {
    const mk = () => makeDb([row("o", "onboarding:A1:new_client"), row("h", "handoff:A1", "pending", "active_client")]);
    let db = mk();
    await sendPendingIntents(db, { deps: { post: ok(), env: { ...URLS, CLIENT_HANDOFF: "live", DUNNING_MODE: "shadow" } } });
    expect(db.rows.map((x: Row) => x.status)).toEqual(["pending", "sent"]);
    db = mk();
    const post = ok();
    expect(await sendPendingIntents(db, { deps: { post, env: { ...URLS, ONBOARDING_INTENTS: "live" } } })).toEqual({ sent: 1, failed: 0 });
    expect(db.rows[1].status).toBe("pending");
  });

  it("nothing live: nothing sent", async () => {
    const db = makeDb([row("o", "onboarding:A1:new_client"), row("h", "handoff:A1", "pending", "active_client")]);
    const post = ok();
    expect(await sendPendingIntents(db, { deps: { post, env: { ...URLS, DUNNING_MODE: "shadow", CLIENT_HANDOFF: "off", ONBOARDING_INTENTS: "off" } } })).toEqual({ sent: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();
  });

  it("DUNNING_MODE=live still sends everything", async () => {
    const db = makeDb([row("o", "onboarding:A1:new_client"), row("e", "live:A1:t:stage:paid", "pending", "active_client")]);
    expect((await sendPendingIntents(db, { deps: { post: ok(), env: { ...URLS, DUNNING_MODE: "live" } } })).sent).toBe(2);
  });
});

describe("enqueueAndSendOnboardingIntent (inline)", () => {
  const account = { id: "A1", contactId: "C" };
  it("ONBOARDING_INTENTS=live: recorded then sent before returning, with a short timeout", async () => {
    const db = makeDb([]);
    const post = ok();
    const r = await enqueueAndSendOnboardingIntent(db, { account, stageKey: "new_client", env: { ...URLS, ONBOARDING_INTENTS: "live", DUNNING_MODE: "shadow" }, send: { post } });
    expect(r.sent).toBe("sent");
    expect(db.rows[0]).toMatchObject({ status: "sent", dedupeKey: "onboarding:A1:new_client" });
  });
  it("off: recorded as skipped_shadow, nothing posted", async () => {
    const db = makeDb([]);
    const post = ok();
    const r = await enqueueAndSendOnboardingIntent(db, { account, stageKey: "new_client", env: URLS, send: { post } });
    expect(r.sent).toBe("off");
    expect(db.rows[0].status).toBe("skipped_shadow");
    expect(post).not.toHaveBeenCalled();
  });
  it("send failure never throws; row stays failed for retry", async () => {
    const db = makeDb([]);
    const r = await enqueueAndSendOnboardingIntent(db, { account, stageKey: "new_client", env: { ...URLS, ONBOARDING_INTENTS: "live" }, send: { post: async () => { throw new Error("boom"); } } });
    expect(r.sent).toBe("failed");
    expect(db.rows[0]).toMatchObject({ status: "failed", attempts: 1 });
  });
  it("db failure never throws", async () => {
    const db: any = { ghlIntent: { create: async () => { throw new Error("db down"); } } };
    expect((await enqueueAndSendOnboardingIntent(db, { account, stageKey: "new_client", env: { ONBOARDING_INTENTS: "live" } })).sent).toBe("error");
  });
});
