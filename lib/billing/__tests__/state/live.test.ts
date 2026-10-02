import { describe, expect, it } from "vitest";
import { applyDunning, isLiveAllowed, liveAllowlist, MANAGED_USER_STATUSES, userStatusFor } from "../../state/apply";
import { sendPendingIntents } from "../../intents/send";
import { hoursAgo, makeFake, member, negBal, NOW, posBal } from "./_fake";

const ENV = { DUNNING_MODE: "live", DUNNING_LIVE_ACCOUNTS: "A1", GHL_INTENT_URL_ACTIVE_CLIENT: "https://hooks.example.test/active" };
const user = (o: Record<string, unknown> = {}) => ({ id: "U1", status: "active", warningCount: 0, ...o });

function rig(accountOver = {}, userOver = {}, extra: { ledger?: any[] } = {}) {
  const db = makeFake([member(accountOver)], extra.ledger ?? [], { writable: true, users: [user(userOver)] });
  const calls = { pause: [] as string[], unpause: [] as string[], posts: [] as any[] };
  const deps = (over: Record<string, unknown> = {}) => ({
    now: () => NOW, env: ENV, readBalance: negBal,
    pause: async (l: string) => void calls.pause.push(l),
    unpause: async (l: string) => void calls.unpause.push(l),
    send: { env: ENV, post: async (u: string, b: unknown) => (calls.posts.push([u, b]), { ok: true, status: 200 }) },
    ...over,
  });
  return { db, calls, deps };
}
const failed = (id: string, at = hoursAgo(1)) => ({ ghlAccountId: "A1", trigger: `ledger:${id}`, event: { kind: "wallet_recharge_failed" as const, wallet: "auto" as const }, eventAt: at });
const strikeTwo = { billingState: "payment_failed", warningCount: 2 };

describe("live branch (only reachable with DUNNING_MODE=live)", () => {
  it("the 3rd strike persists account + User in ONE transaction, writes a live decision, enqueues an intent, sends it — and does NOT pause the location", async () => {
    const { db, calls, deps } = rig(strikeTwo);
    const r = await applyDunning(db, failed("s3"), { mode: "live", deps: deps() });
    expect(r).toMatchObject({ status: "recorded", mode: "live" });
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]).toMatchObject({ mode: "live", toState: "paused", toStrikes: 3, pauseReason: "non_payment", sideEffects: [] });
    expect(db.writes.filter((w: string) => w.startsWith("ghlAccount"))).toHaveLength(1);
    expect(db.users[0]).toMatchObject({ status: "suspended", warningCount: 3 }); // User mirror while User is the live gate
    expect(db.intents).toHaveLength(1);
    expect(db.intents[0]).toMatchObject({ status: "sent", attempts: 1, kind: "stage" });
    expect(calls.posts).toEqual([["https://hooks.example.test/active", expect.objectContaining({ contactId: "CONTACT_A1", stage: "paused", fields: expect.objectContaining({ pause_reason: "non_payment" }) })]]);
    expect(calls.pause).toEqual([]); // saas_pause waits for pause_confirmed
  });

  it("pause_confirmed while still paused executes saas_pause (and records that it ran)", async () => {
    const { db, calls, deps } = rig({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" }, { status: "suspended", warningCount: 3 });
    const r = await applyDunning(db, { ghlAccountId: "A1", trigger: "command:paused_confirm:e1", event: { kind: "pause_confirmed" }, eventAt: hoursAgo(0.1) }, { mode: "live", deps: deps() });
    expect(r.status).toBe("recorded");
    expect(calls.pause).toEqual(["LOC_A1"]);
    expect(db.decisions[0].sideEffects).toEqual([expect.objectContaining({ type: "saas_pause", executedAt: expect.any(String) })]);
    expect(db.intents).toHaveLength(0); // nothing changed state → no intent
  });

  it("pause_confirmed after a cure: no pause at all", async () => {
    const { db, calls, deps } = rig({ billingState: "active" });
    await applyDunning(db, { ghlAccountId: "A1", trigger: "command:paused_confirm:e2", event: { kind: "pause_confirmed" }, eventAt: hoursAgo(0.1) }, { mode: "live", deps: deps() });
    expect(calls.pause).toEqual([]);
    expect(db.decisions[0].reason).toMatch(/cured before confirmation, no pause/);
  });

  it("a cure (recharge succeeded, balance >= 0) resumes the location immediately and reactivates the User", async () => {
    const { db, calls, deps } = rig({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" }, { status: "suspended", warningCount: 3 });
    const r = await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:cure", event: { kind: "wallet_recharge_succeeded", wallet: "auto" }, eventAt: hoursAgo(1) }, { mode: "live", deps: deps({ readBalance: posBal }) });
    expect(r.status).toBe("recorded");
    expect(calls.unpause).toEqual(["LOC_A1"]);
    expect(db.users[0]).toMatchObject({ status: "active", warningCount: 0 });
    expect(db.decisions[0].sideEffects[0]).toMatchObject({ type: "saas_resume", executedAt: expect.any(String) });
    expect(db.intents[0].payload.stage).toBe("active");
  });

  it("sweep-driven churn pauses immediately (deliberate, no debounce) and maps User to inactive", async () => {
    const { db, calls, deps } = rig({ billingState: "active" });
    await applyDunning(db, { ghlAccountId: "A1", trigger: "sub:s1:canceled", event: { kind: "subscription_canceled", duringTrial: false }, eventAt: NOW }, { mode: "live", deps: deps() });
    expect(calls.pause).toEqual(["LOC_A1"]);
    expect(db.users[0].status).toBe("inactive");
    expect(db.decisions[0].toState).toBe("churned");
  });

  it("idempotent: the same trigger twice changes state, sends and executes ONCE", async () => {
    const { db, calls, deps } = rig({ billingState: "active" });
    const ev = { ghlAccountId: "A1", trigger: "sub:s1:canceled", event: { kind: "subscription_canceled" as const, duringTrial: false }, eventAt: NOW };
    expect((await applyDunning(db, ev, { mode: "live", deps: deps() })).status).toBe("recorded");
    expect((await applyDunning(db, ev, { mode: "live", deps: deps() })).status).toBe("duplicate");
    expect(calls.pause).toHaveLength(1);
    expect(calls.posts).toHaveLength(1);
    expect(db.decisions).toHaveLength(1);
    expect(db.intents).toHaveLength(1);
  });

  it("ATOMIC: a failure inside the transaction (intent enqueue) rolls back the decision, account and User — and executes nothing", async () => {
    const { db, calls, deps } = rig(strikeTwo);
    db.ghlIntent.create = async () => { throw new Error("outbox unavailable"); };
    await expect(applyDunning(db, failed("s3"), { mode: "live", deps: deps() })).rejects.toThrow(/outbox unavailable/);
    expect(db.decisions).toHaveLength(0);
    expect(db.intents).toHaveLength(0);
    expect(db.users[0]).toMatchObject({ status: "active", warningCount: 0 });
    expect(db.writes).toEqual([]);
    expect(calls.pause).toEqual([]);
    expect(calls.posts).toEqual([]);
  });

  it("a side-effect failure AFTER commit is recorded on the decision and does not undo the state or block the intent", async () => {
    const { db, calls, deps } = rig({ billingState: "active" });
    await applyDunning(db, { ghlAccountId: "A1", trigger: "sub:s1:canceled", event: { kind: "subscription_canceled", duringTrial: false }, eventAt: NOW }, { mode: "live", deps: deps({ pause: async () => { throw new Error("GHL 500"); } }) });
    expect(db.decisions[0].sideEffects[0]).toMatchObject({ type: "saas_pause", error: "GHL 500" });
    expect(db.decisions[0].sideEffects[0].executedAt).toBeUndefined();
    expect(db.users[0].status).toBe("inactive"); // committed
    expect(calls.posts).toHaveLength(1); // intent still sent
  });

  it("an intent send failure is recorded as failed and retried later (max 5)", async () => {
    const { db, deps } = rig(strikeTwo);
    await applyDunning(db, failed("s3"), { mode: "live", deps: deps({ send: { env: ENV, post: async () => ({ ok: false, status: 503 }) } }) });
    expect(db.intents[0]).toMatchObject({ status: "failed", attempts: 1 });
    await sendPendingIntents(db, { deps: { env: ENV, post: async () => ({ ok: true, status: 200 }) } });
    expect(db.intents[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("User: only active/suspended/inactive are overwritten — an onboarding status stays (warningCount still mirrors)", async () => {
    const { db } = rig(strikeTwo, { status: "onboarding_complete" });
    const { deps } = rig();
    await applyDunning(db, failed("s3"), { mode: "live", deps: deps() });
    expect(db.users[0]).toMatchObject({ status: "onboarding_complete", warningCount: 3 });
    expect(MANAGED_USER_STATUSES).toEqual(["active", "suspended", "inactive"]);
  });

  it("GATE: an account NOT in DUNNING_LIVE_ACCOUNTS is processed as shadow even in live mode — no state, no User, no effects, no send", async () => {
    const { db, calls, deps } = rig(strikeTwo);
    const r = await applyDunning(db, failed("s3"), { mode: "live", deps: deps({ env: { ...ENV, DUNNING_LIVE_ACCOUNTS: "SOME_OTHER_ACCOUNT" } }) });
    expect(r).toMatchObject({ status: "recorded", mode: "shadow" });
    expect(db.decisions[0].mode).toBe("shadow");
    expect(db.writes).toEqual([]);
    expect(db.users[0]).toMatchObject({ status: "active", warningCount: 0 });
    expect(db.intents.map((i: any) => i.status)).toEqual(["skipped_shadow"]);
    expect(calls.pause).toEqual([]);
    expect(calls.posts).toEqual([]);
  });

  it("the allowlist accepts a GhlAccount id or a locationId, and is empty by default", () => {
    expect(liveAllowlist({})).toEqual([]);
    expect(liveAllowlist({ DUNNING_LIVE_ACCOUNTS: " A1 , LOC_X ,, " })).toEqual(["A1", "LOC_X"]);
    expect(isLiveAllowed({ id: "A1", locationId: null }, { DUNNING_LIVE_ACCOUNTS: "A1" })).toBe(true);
    expect(isLiveAllowed({ id: "A2", locationId: "LOC_X" }, { DUNNING_LIVE_ACCOUNTS: "A1,LOC_X" })).toBe(true);
    expect(isLiveAllowed({ id: "A2", locationId: "LOC_X" }, {})).toBe(false);
  });

  it("live projects from the persisted account (not from shadow rows), and keeps the open-core-failure flag from its own decisions", async () => {
    const { db, deps } = rig({ billingState: "active" });
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:cf", event: { kind: "core_failed" }, eventAt: hoursAgo(2) }, { mode: "live", deps: deps() });
    expect(db.decisions[0]).toMatchObject({ toState: "payment_failed", coreFailureOpen: true });
    // a wallet recharge success with a positive balance must NOT clear payment_failed while the core failure is open
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:ws", event: { kind: "wallet_recharge_succeeded", wallet: "auto" }, eventAt: hoursAgo(1) }, { mode: "live", deps: deps({ readBalance: posBal }) });
    expect(db.decisions[1]).toMatchObject({ fromState: "payment_failed", toState: "payment_failed", coreFailureOpen: true });
  });

  it("userStatusFor maps states", () => {
    expect([userStatusFor("active"), userStatusFor("trial"), userStatusFor("payment_failed"), userStatusFor("paused"), userStatusFor("inactive"), userStatusFor("churned"), userStatusFor(null)]).toEqual(["active", "active", "active", "suspended", "inactive", "inactive", null]);
  });
});

describe("live is OFF by default", () => {
  it("with no DUNNING_MODE, applyDunning is shadow: nothing is written to the account or User", async () => {
    const prev = process.env.DUNNING_MODE;
    delete process.env.DUNNING_MODE;
    try {
      const { db, calls, deps } = rig(strikeTwo);
      const r = await applyDunning(db, failed("s3"), { deps: deps({ env: {} }) });
      expect(r).toMatchObject({ status: "recorded", mode: "shadow" });
      expect(db.writes).toEqual([]);
      expect(calls.pause).toEqual([]);
      expect(calls.posts).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.DUNNING_MODE = prev;
    }
  });
});
