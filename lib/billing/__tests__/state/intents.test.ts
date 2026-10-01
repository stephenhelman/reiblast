import { describe, expect, it } from "vitest";
import { buildIntentBody, enqueueIntents, enqueuePlacementIntent, intentUrl, MAX_INTENT_ATTEMPTS, sendIntent, sendPendingIntents } from "../../intents/send";
import type { Decision } from "../../state/types";
import { makeFake } from "./_fake";

const acct = { id: "A1", contactId: "CONTACT_A1", trialOffer: "30 Day Trial" as string | null, trialEndsAt: new Date("2026-10-25T23:05:48Z") as Date | null };
const decision = (over: Partial<Decision> = {}): Pick<Decision, "intents" | "pauseReason" | "trialOffer" | "trialEndsAt" | "trialChanged"> => ({
  intents: [{ pipeline: "active_client", stage: "paused", fields: {} }],
  pauseReason: "non_payment", trialOffer: null, trialEndsAt: null, trialChanged: false, ...over,
});
const LIVE_ENV = { DUNNING_MODE: "live", GHL_INTENT_URL_ACTIVE_CLIENT: "https://hooks.example.test/active", GHL_INTENT_URL_ONBOARDING: "https://hooks.example.test/onb" };

describe("intent body", () => {
  it("stage keys equal BillingState values; fields are the account's CURRENT values (a stage move never blanks the trial fields)", () => {
    const b = buildIntentBody({ contactId: "C1", intent: { pipeline: "active_client", stage: "payment_failed" }, pauseReason: null, trialOffer: "7 Day Trial", trialEndsAt: new Date("2026-10-05T05:00:00Z") });
    expect(b).toEqual({ contactId: "C1", pipeline: "active_client", stage: "payment_failed", fields: { pause_reason: null, trial_offer: "7 Day Trial", trial_end_date: "2026-10-04" } }); // Denver date (05:00Z is Oct 4 23:00 MDT)
  });
  it("blank fields are null, not omitted", () => {
    expect(buildIntentBody({ contactId: "C1", intent: { pipeline: "active_client", stage: "active" }, pauseReason: null, trialOffer: null, trialEndsAt: null }).fields).toEqual({ pause_reason: null, trial_offer: null, trial_end_date: null });
  });
  it("URLs come from env per pipeline", () => {
    expect(intentUrl("active_client", LIVE_ENV)).toBe("https://hooks.example.test/active");
    expect(intentUrl("onboarding", LIVE_ENV)).toBe("https://hooks.example.test/onb");
    expect(intentUrl("active_client", {})).toBeNull();
    expect(intentUrl("other", LIVE_ENV)).toBeNull();
  });
});

describe("recording (always first)", () => {
  it("shadow: recorded as skipped_shadow; live+allowlisted: pending; live but not allowlisted: skipped with the reason", async () => {
    const db = makeFake([]);
    await enqueueIntents(db, { account: acct, trigger: "ledger:t1", mode: "shadow", decision: decision(), sendable: false });
    await enqueueIntents(db, { account: acct, trigger: "ledger:t2", mode: "live", decision: decision(), sendable: true });
    await enqueueIntents(db, { account: acct, trigger: "ledger:t3", mode: "live", decision: decision(), sendable: false });
    expect(db.intents.map((i: any) => i.status)).toEqual(["skipped_shadow", "pending", "skipped_shadow"]);
    expect(db.intents[2].lastError).toMatch(/not allowlisted/);
    expect(db.intents[0]).toMatchObject({ kind: "stage", pipeline: "active_client", ghlAccountId: "A1", attempts: 0 });
    expect(db.intents[0].payload).toMatchObject({ contactId: "CONTACT_A1", stage: "paused", fields: { pause_reason: "non_payment", trial_offer: "30 Day Trial", trial_end_date: "2026-10-25" } });
  });
  it("is idempotent on dedupeKey", async () => {
    const db = makeFake([]);
    const a = await enqueueIntents(db, { account: acct, trigger: "ledger:t1", mode: "shadow", decision: decision(), sendable: false });
    const b = await enqueueIntents(db, { account: acct, trigger: "ledger:t1", mode: "shadow", decision: decision(), sendable: false });
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
    expect(db.intents).toHaveLength(1);
  });
  it("a fields-only intent is recorded with kind 'fields', and this decision's trial values win when they changed", async () => {
    const db = makeFake([]);
    await enqueueIntents(db, { account: acct, trigger: "sub:s1:trialing", mode: "shadow", decision: decision({ intents: [{ pipeline: "active_client", stage: "trial", kind: "fields", fields: {} }], trialChanged: true, trialOffer: "7 Day Trial", trialEndsAt: new Date("2026-11-01T12:00:00Z"), pauseReason: null }), sendable: false });
    expect(db.intents[0]).toMatchObject({ kind: "fields" });
    expect(db.intents[0].payload.fields).toEqual({ pause_reason: null, trial_offer: "7 Day Trial", trial_end_date: "2026-11-01" });
  });
  it("no intents in the decision → nothing recorded", async () => {
    const db = makeFake([]);
    expect(await enqueueIntents(db, { account: acct, trigger: "x", mode: "shadow", decision: decision({ intents: [] }), sendable: false })).toEqual([]);
  });
});

describe("sending", () => {
  const seed = async (status = "pending") => {
    const db = makeFake([]);
    await enqueueIntents(db, { account: acct, trigger: "ledger:t1", mode: "live", decision: decision(), sendable: true });
    db.intents[0].status = status;
    return db;
  };
  it("posts the recorded body to the pipeline URL and marks it sent", async () => {
    const db = await seed();
    const calls: any[] = [];
    expect(await sendIntent(db, db.intents[0].id, { env: LIVE_ENV, post: async (u, b) => (calls.push([u, b]), { ok: true, status: 200 }) })).toBe("sent");
    expect(calls).toEqual([["https://hooks.example.test/active", db.intents[0].payload]]);
    expect(db.intents[0]).toMatchObject({ status: "sent", attempts: 1, lastError: null });
    expect(db.intents[0].sentAt).toBeInstanceOf(Date);
  });
  it("a failure is recorded (status failed, attempts+1, lastError), never thrown", async () => {
    const db = await seed();
    expect(await sendIntent(db, db.intents[0].id, { env: LIVE_ENV, post: async () => ({ ok: false, status: 502 }) })).toBe("failed");
    expect(db.intents[0]).toMatchObject({ status: "failed", attempts: 1, lastError: expect.stringMatching(/HTTP 502/) });
    expect(await sendIntent(db, db.intents[0].id, { env: LIVE_ENV, post: async () => { throw new Error("network down"); } })).toBe("failed");
    expect(db.intents[0]).toMatchObject({ attempts: 2, lastError: "network down" });
  });
  it("a missing URL is a recorded failure", async () => {
    const db = await seed();
    expect(await sendIntent(db, db.intents[0].id, { env: {}, post: async () => ({ ok: true, status: 200 }) })).toBe("failed");
    expect(db.intents[0].lastError).toMatch(/no intent URL/);
  });
  it("retries failed intents up to 5 attempts, then stops", async () => {
    const db = await seed();
    let posts = 0;
    const deps = { env: LIVE_ENV, post: async () => (posts++, { ok: false, status: 500 }) };
    for (let i = 0; i < 8; i++) await sendPendingIntents(db, { deps });
    expect(posts).toBe(MAX_INTENT_ATTEMPTS);
    expect(db.intents[0]).toMatchObject({ status: "failed", attempts: MAX_INTENT_ATTEMPTS });
    const ok = await seed();
    let n = 0;
    await sendPendingIntents(ok, { deps: { env: LIVE_ENV, post: async () => (++n === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 }) } });
    await sendPendingIntents(ok, { deps: { env: LIVE_ENV, post: async () => ({ ok: true, status: 200 }) } });
    expect(ok.intents[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
  it("skipped_shadow and sent intents are never sent", async () => {
    const db = await seed("skipped_shadow");
    let posts = 0;
    await sendPendingIntents(db, { deps: { env: LIVE_ENV, post: async () => (posts++, { ok: true, status: 200 }) } });
    db.intents[0].status = "sent";
    await sendPendingIntents(db, { deps: { env: LIVE_ENV, post: async () => (posts++, { ok: true, status: 200 }) } });
    expect(posts).toBe(0);
    expect(await sendIntent(db, db.intents[0].id, { env: LIVE_ENV })).toBe("skipped");
  });
  it("HARD GATE: sendPendingIntents does nothing unless DUNNING_MODE=live — even with pending rows and URLs configured", async () => {
    const db = await seed();
    let posts = 0;
    const post = async () => (posts++, { ok: true, status: 200 });
    for (const env of [{ ...LIVE_ENV, DUNNING_MODE: "shadow" }, { ...LIVE_ENV, DUNNING_MODE: undefined }]) {
      expect(await sendPendingIntents(db, { deps: { env: env as any, post } })).toEqual({ sent: 0, failed: 0 });
    }
    expect(posts).toBe(0);
    expect(db.intents[0].status).toBe("pending");
  });
});

describe("enqueuePlacementIntent (used by lib/billing/onboardingIntents.ts)", () => {
  const fields = { pause_reason: null, trial_offer: null, trial_end_date: null };
  it("records a stage-key intent under a caller-supplied dedupeKey, same status rules as enqueueIntents", async () => {
    const db = makeFake([]);
    const shadow = await enqueuePlacementIntent(db, { account: acct, pipeline: "active_client", stage: "active", fields, dedupeKey: "place:A1:active", mode: "shadow", sendable: false });
    expect(shadow.created).toBe(true);
    expect(db.intents[0]).toMatchObject({ dedupeKey: "place:A1:active", status: "skipped_shadow", pipeline: "active_client" });
    expect(db.intents[0].payload).toMatchObject({ stage: "active" });

    const live = await enqueuePlacementIntent(db, { account: acct, pipeline: "onboarding", stage: "a2p_approved", fields, dedupeKey: "place-onb:A1:a2p_approved", mode: "live", sendable: true });
    expect(db.intents[1]).toMatchObject({ dedupeKey: "place-onb:A1:a2p_approved", status: "pending", pipeline: "onboarding" });
    expect(live.created).toBe(true);
  });
  it("is idempotent on dedupeKey — a repeat returns the SAME id and creates nothing new", async () => {
    const db = makeFake([]);
    const first = await enqueuePlacementIntent(db, { account: acct, pipeline: "active_client", stage: "paused", fields, dedupeKey: "place:A1:paused", mode: "shadow", sendable: false });
    const second = await enqueuePlacementIntent(db, { account: acct, pipeline: "active_client", stage: "paused", fields, dedupeKey: "place:A1:paused", mode: "shadow", sendable: false });
    expect(second).toEqual({ id: first.id, created: false });
    expect(db.intents).toHaveLength(1);
  });
});
