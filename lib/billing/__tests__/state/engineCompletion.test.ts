import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "../../state/transition";
import { applyDunning } from "../../state/apply";
import { handoffToClients } from "../../clientHandoff";
import { processStageChanged } from "../../events/stageChanged";
import { sendPendingIntents } from "../../intents/send";
import type { BalanceReading, BillingState, Context, DunningEvent, Snapshot } from "../../state/types";
import { hoursAgo, makeFake, member, NOW } from "./_fake";

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ state: "active", strikes: 0, pauseReason: null, coreFailureOpen: false, ...o });
const neg: BalanceReading = { status: "ok", value: "-5.000000", estimated: false };
const pos: BalanceReading = { status: "ok", value: "12.500000", estimated: false };
const ctx = (o: Partial<Context> = {}): Context => ({ now: NOW, coveredUntil: null, ...o });
const HANDED: Context["routing"] = { handedOff: true, onboardingProgress: "A2P Approved" };
const ONB = (onboardingProgress: string | null): Context["routing"] => ({ handedOff: false, onboardingProgress });
const wFail: DunningEvent = { kind: "wallet_recharge_failed", wallet: "auto" };
const wOk: DunningEvent = { kind: "wallet_recharge_succeeded", wallet: "auto" };
const coreOk: DunningEvent = { kind: "core_succeeded" };
const coreFail: DunningEvent = { kind: "core_failed" };
const pipes = (d: ReturnType<typeof decide>) => d.intents.map((i) => `${i.pipeline}:${i.stage}`);

describe("B10 — pipeline routing", () => {
  it("handed-off member: billing intents go to the Clients pipeline", () => {
    expect(pipes(decide(snap(), wFail, ctx({ walletBalance: neg, routing: HANDED })))).toEqual(["active_client:payment_failed"]);
    expect(pipes(decide(snap({ state: "payment_failed", strikes: 2 }), wFail, ctx({ walletBalance: neg, routing: HANDED })))).toEqual(["active_client:paused"]);
  });
  it("routing omitted behaves as handed off", () => {
    expect(pipes(decide(snap(), wFail, ctx({ walletBalance: neg })))).toEqual(["active_client:payment_failed"]);
  });
  it("onboarding member: payment_failed → onboarding Payment Failed", () => {
    const d = decide(snap(), wFail, ctx({ walletBalance: neg, routing: ONB("KYC Complete") }));
    expect(d.nextState).toBe("payment_failed");
    expect(pipes(d)).toEqual(["onboarding:payment_failed"]);
  });
  it("onboarding member: 3rd strike → onboarding Paused (and saas_pause in the decision)", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 2 }), wFail, ctx({ walletBalance: neg, routing: ONB("A2P Pending") }));
    expect(pipes(d)).toEqual(["onboarding:paused"]);
    expect(d.sideEffects).toEqual([{ type: "saas_pause" }]);
  });
  it("onboarding member: expired invoice and a core failure route the same way", () => {
    expect(pipes(decide(snap(), { kind: "invoice_expired" }, ctx({ routing: ONB("New Client") })))).toEqual(["onboarding:paused"]);
    expect(pipes(decide(snap(), coreFail, ctx({ routing: ONB("New Client") })))).toEqual(["onboarding:payment_failed"]);
  });
  it("onboarding member: trial / trial-field refreshes / inactive / churned send nothing to either pipeline", () => {
    const trial = decide(snap({ state: null }), { kind: "trial_auth_succeeded" }, ctx({ routing: ONB("New Client"), subscription: { name: "14 Day Trial", trialEndsAt: null } }));
    expect(trial.nextState).toBe("trial");
    expect(trial.intents).toEqual([]);
    const refresh = decide(snap({ state: "trial" }), { kind: "trial_auth_succeeded" }, ctx({ routing: ONB("New Client"), subscription: { name: "14 Day Trial", trialEndsAt: null } }));
    expect(refresh.intents).toEqual([]);
    expect(decide(snap(), { kind: "command", stage: "inactive" }, ctx({ routing: ONB("New Client") })).intents).toEqual([]);
    expect(decide(snap(), { kind: "subscription_expired" }, ctx({ routing: ONB("New Client") })).intents).toEqual([]);
  });
  it("the same decision for handed-off vs onboarding differs only in intents (state, strikes, effects unchanged)", () => {
    const a = decide(snap(), wFail, ctx({ walletBalance: neg, routing: HANDED }));
    const b = decide(snap(), wFail, ctx({ walletBalance: neg, routing: ONB("New Client") }));
    expect({ ...a, intents: [] }).toEqual({ ...b, intents: [] });
  });
});

describe("B11 — return after cure", () => {
  it("handed off: core success from payment_failed and from paused → Active Member", () => {
    expect(pipes(decide(snap({ state: "payment_failed", coreFailureOpen: true }), coreOk, ctx({ routing: HANDED })))).toEqual(["active_client:active"]);
    expect(pipes(decide(snap({ state: "paused", pauseReason: "expired_invoice", coreFailureOpen: true }), coreOk, ctx({ routing: HANDED })))).toEqual(["active_client:active"]);
  });
  it("handed off: a wallet recharge leaving balance ≥ 0 → Active Member; a negative balance does not", () => {
    expect(pipes(decide(snap({ state: "payment_failed", strikes: 1 }), wOk, ctx({ walletBalance: pos, routing: HANDED })))).toEqual(["active_client:active"]);
    expect(decide(snap({ state: "payment_failed", strikes: 1 }), wOk, ctx({ walletBalance: neg, routing: HANDED })).intents).toEqual([]);
  });
  it("onboarding: a cure returns the card to the stage matching onboardingProgress", () => {
    for (const [progress, key] of [["New Client", "new_client"], ["Awaiting KYC", "awaiting_kyc"], ["A2P Pending", "a2p_pending"], ["A2P Approved", "a2p_approved"]] as const) {
      expect(pipes(decide(snap({ state: "payment_failed", coreFailureOpen: true }), coreOk, ctx({ routing: ONB(progress) })))).toEqual([`onboarding:${key}`]);
      expect(pipes(decide(snap({ state: "paused", pauseReason: "non_payment", strikes: 3 }), wOk, ctx({ walletBalance: pos, routing: ONB(progress) })))).toEqual([`onboarding:${key}`]);
    }
  });
  it("onboarding: never forward and never a side stage — the stage is exactly the stored progress", () => {
    const d = decide(snap({ state: "payment_failed", coreFailureOpen: true }), coreOk, ctx({ routing: ONB("Onboarding Form Confirmed") }));
    expect(pipes(d)).toEqual(["onboarding:onboarding_form_confirmed"]);
    for (const side of ["Payment Failed", "Paused", "Blocker Detected", "garbage"]) {
      const x = decide(snap({ state: "payment_failed", coreFailureOpen: true }), coreOk, ctx({ routing: ONB(side) }));
      expect(x.nextState).toBe("active");
      expect(x.intents).toEqual([]); // no card move rather than a guess
      expect(x.reason).toMatch(/no recorded progress stage/);
    }
    expect(decide(snap({ state: "payment_failed", coreFailureOpen: true }), coreOk, ctx({ routing: ONB(null) })).intents).toEqual([]);
  });
  it("onboarding: a payment that is not a cure (trial → active) moves no onboarding card", () => {
    expect(decide(snap({ state: "trial" }), coreOk, ctx({ routing: ONB("A2P Pending") })).intents).toEqual([]);
  });
});

describe("B6 — pause timing: saas_pause is part of the paused decision", () => {
  it("3rd strike, expired invoice and manual Paused all carry saas_pause", () => {
    expect(decide(snap({ state: "payment_failed", strikes: 2 }), wFail, ctx({ walletBalance: neg })).sideEffects).toEqual([{ type: "saas_pause" }]);
    expect(decide(snap(), { kind: "invoice_expired" }, ctx()).sideEffects).toEqual([{ type: "saas_pause" }]);
    expect(decide(snap(), { kind: "command", stage: "paused" }, ctx()).sideEffects).toEqual([{ type: "saas_pause" }]);
  });
  it("strikes 1 and 2 pause nothing", () => {
    expect(decide(snap(), wFail, ctx({ walletBalance: neg })).sideEffects).toEqual([]);
    expect(decide(snap({ state: "payment_failed", strikes: 1 }), wFail, ctx({ walletBalance: neg })).sideEffects).toEqual([]);
  });
  it("coverage still protects an expired invoice (no pause)", () => {
    expect(decide(snap(), { kind: "invoice_expired" }, ctx({ coveredUntil: new Date("2026-10-30T00:00:00Z") })).sideEffects).toEqual([]);
  });
  it("pause_confirmed, if still delivered, decides nothing", () => {
    const d = decide(snap({ state: "paused", pauseReason: "non_payment" }), { kind: "pause_confirmed" }, ctx());
    expect(d).toMatchObject({ noop: true, sideEffects: [], intents: [] });
  });
});

describe("confirmed rules (payments never move parked accounts; killswitch; trial ended)", () => {
  const payments: [string, DunningEvent, Context][] = [
    ["wallet failed", wFail, ctx({ walletBalance: neg })],
    ["wallet succeeded", wOk, ctx({ walletBalance: pos })],
    ["core failed", coreFail, ctx()],
    ["core succeeded", coreOk, ctx()],
    ["trial_auth", { kind: "trial_auth_succeeded" }, ctx({ subscription: { name: "14 Day Trial", trialEndsAt: null } })],
    ["invoice expired", { kind: "invoice_expired" }, ctx()],
    ["subscription trialing", { kind: "subscription_trialing" }, ctx()],
  ];
  for (const state of ["inactive", "churned"] as BillingState[]) {
    for (const routing of [HANDED, ONB("A2P Approved")]) {
      it(`a payment event never moves a ${state} account (${routing?.handedOff ? "Clients" : "onboarding"})`, () => {
        for (const [, ev, c] of payments) {
          const d = decide(snap({ state, pauseReason: state === "inactive" ? "voluntary" : null }), ev, { ...c, routing });
          expect(d).toMatchObject({ nextState: state, noop: true, sideEffects: [], intents: [] });
        }
      });
    }
  }
  it("a manual_killswitch pause is never auto-resumed by a payment (core success or a recharge with balance ≥ 0)", () => {
    for (const routing of [HANDED, ONB("KYC Complete")]) {
      const paused = snap({ state: "paused", pauseReason: "manual_killswitch", strikes: 0 });
      for (const [ev, c] of [[coreOk, ctx({ routing })], [wOk, ctx({ walletBalance: pos, routing })]] as [DunningEvent, Context][]) {
        const d = decide(paused, ev, c);
        expect(d.nextState).toBe("paused");
        expect(d.pauseReason).toBe("manual_killswitch");
        expect(d.sideEffects.map((e) => e.type)).not.toContain("saas_resume");
        expect(d.intents).toEqual([]);
      }
    }
  });
  it("a voluntary pause (inactive) is likewise never auto-resumed", () => {
    const d = decide(snap({ state: "inactive", pauseReason: "voluntary" }), coreOk, ctx());
    expect(d.nextState).toBe("inactive");
  });
  it("trial_ended_unconverted → payment_failed (core failure open); only from trial", () => {
    const d = decide(snap({ state: "trial" }), { kind: "trial_ended_unconverted" }, ctx({ routing: HANDED }));
    expect(d).toMatchObject({ nextState: "payment_failed", coreFailureOpen: true });
    expect(pipes(d)).toEqual(["active_client:payment_failed"]);
    expect(pipes(decide(snap({ state: "trial" }), { kind: "trial_ended_unconverted" }, ctx({ routing: ONB("A2P Pending") })))).toEqual(["onboarding:payment_failed"]);
    expect(decide(snap({ state: "active" }), { kind: "trial_ended_unconverted" }, ctx()).noop).toBe(true);
  });
});

describe("shadow write path records the routed intents (skipped_shadow, never sent)", () => {
  const deps = { now: () => NOW, env: {}, readBalance: async () => neg };
  const fail = { ghlAccountId: "A1", trigger: "ledger:t1", event: wFail, eventAt: hoursAgo(1) };
  it("an onboarding member's strike records an onboarding intent", async () => {
    const db = makeFake([member({ activeClientSince: null, onboardingProgress: "KYC Complete" })]);
    await applyDunning(db, fail, { mode: "shadow", deps });
    expect(db.intents).toHaveLength(1);
    expect(db.intents[0]).toMatchObject({ pipeline: "onboarding", status: "skipped_shadow", payload: { stage: "payment_failed", pipeline: "onboarding", contactId: "CONTACT_A1" } });
    expect(db.intents[0].dedupeKey).toBe("shadow:A1:ledger:t1:stage:onboarding:payment_failed");
  });
  it("a handed-off member's strike records a Clients intent", async () => {
    const db = makeFake([member()]);
    await applyDunning(db, fail, { mode: "shadow", deps });
    expect(db.intents[0]).toMatchObject({ pipeline: "active_client", status: "skipped_shadow", payload: { stage: "payment_failed" } });
  });
});

describe("B5 — handoffToClients", () => {
  const HIST = { GHL_INTENT_URL_ACTIVE_CLIENT: "https://hooks.example.test/active" };
  const posts: any[] = [];
  const send = { post: async (u: string, b: unknown) => (posts.push([u, b]), { ok: true, status: 200 }) };
  beforeEach(() => { posts.length = 0; });
  const acct = (o = {}) => member({ activeClientSince: null, ...o });

  it("live: places the card by billing state, sets activeClientSince, sends ONE active_client intent", async () => {
    const expected: [BillingState, string][] = [["trial", "trial"], ["active", "active"], ["payment_failed", "payment_failed"], ["paused", "paused"]];
    for (const [state, stage] of expected) {
      posts.length = 0;
      const db = makeFake([acct({ billingState: state })], [], { writable: true });
      const r = await handoffToClients(db, "A1", { env: { ...HIST, CLIENT_HANDOFF: "live" }, now: NOW, send });
      expect(r).toMatchObject({ status: "handed_off", stage, sent: "sent" });
      expect(db.intents).toHaveLength(1);
      expect(db.intents[0]).toMatchObject({ pipeline: "active_client", status: "sent", dedupeKey: "handoff:A1" });
      expect(posts).toEqual([[HIST.GHL_INTENT_URL_ACTIVE_CLIENT, { contactId: "CONTACT_A1", pipeline: "active_client", stage, fields: expect.any(Object) }]]);
      expect((await db.ghlAccount.findUnique({ where: { id: "A1" } })).activeClientSince).toEqual(NOW);
    }
  });
  it("carries the account's current trial / pause fields", async () => {
    const db = makeFake([acct({ billingState: "trial", trialOffer: "14 Day Trial", trialEndsAt: new Date("2026-10-05T18:00:00Z") })], [], { writable: true });
    await handoffToClients(db, "A1", { env: { ...HIST, CLIENT_HANDOFF: "live" }, send });
    expect(posts[0][1].fields).toEqual({ pause_reason: null, trial_offer: "14 Day Trial", trial_end_date: "2026-10-05" });
  });
  it("null billingState: NO intent, activeClientSince stays null, listed for review", async () => {
    const db = makeFake([acct({ billingState: null })], [], { writable: true });
    const r = await handoffToClients(db, "A1", { env: { ...HIST, CLIENT_HANDOFF: "live" }, send });
    expect(r.status).toBe("no_billing_state");
    expect(db.intents).toEqual([]);
    expect(posts).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(db.events).toEqual([expect.objectContaining({ source: "client_handoff_review", externalId: "CONTACT_A1" })]);
  });
  it("CLIENT_HANDOFF off (default): records a skipped_shadow preview, sends nothing, writes nothing", async () => {
    for (const env of [{}, { CLIENT_HANDOFF: "off" }, { CLIENT_HANDOFF: "true" }, { DUNNING_MODE: "live", DUNNING_LIVE_ACCOUNTS: "A1" }]) {
      const db = makeFake([acct({ billingState: "active" })], [], { writable: true });
      const r = await handoffToClients(db, "A1", { env: { ...HIST, ...env }, send });
      expect(r.status).toBe("shadow");
      expect(db.intents).toEqual([expect.objectContaining({ status: "skipped_shadow", dedupeKey: "handoff-shadow:A1" })]);
      expect(db.writes).toEqual([]);
    }
    expect(posts).toEqual([]);
  });
  it("independent of DUNNING_MODE: CLIENT_HANDOFF=live sends while DUNNING_MODE is shadow", async () => {
    const db = makeFake([acct()], [], { writable: true });
    expect((await handoffToClients(db, "A1", { env: { ...HIST, CLIENT_HANDOFF: "live", DUNNING_MODE: "shadow" }, send })).status).toBe("handed_off");
    expect(posts).toHaveLength(1);
  });
  it("idempotent: a second call (or an already handed-off account) sends nothing more", async () => {
    const db = makeFake([acct()], [], { writable: true });
    const env = { ...HIST, CLIENT_HANDOFF: "live" };
    await handoffToClients(db, "A1", { env, send });
    expect((await handoffToClients(db, "A1", { env, send })).status).toBe("already_handed_off");
    expect(posts).toHaveLength(1);
    expect((await handoffToClients(makeFake([member()], [], { writable: true }), "A1", { env, send })).status).toBe("already_handed_off");
  });
  it("a failed send leaves a failed intent that the CLIENT_HANDOFF retry picks up — even with DUNNING_MODE=shadow", async () => {
    const db = makeFake([acct()], [], { writable: true });
    const env = { ...HIST, CLIENT_HANDOFF: "live" };
    const r = await handoffToClients(db, "A1", { env, send: { post: async () => ({ ok: false, status: 500 }) } });
    expect(r).toMatchObject({ status: "handed_off", sent: "failed" });
    expect(db.intents[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(await sendPendingIntents(db, { deps: { env, post: send.post } })).toEqual({ sent: 1, failed: 0 });
    expect(db.intents[0].status).toBe("sent");
  });
  it("sendPendingIntents: with CLIENT_HANDOFF off and DUNNING_MODE shadow nothing is retried; with only the handoff live, only handoff rows are", async () => {
    const db = makeFake([acct()], [], { writable: true });
    db.intents.push({ id: "x1", status: "pending", attempts: 0, dedupeKey: "live:A1:ledger:z:stage:paused", pipeline: "active_client", payload: {} }, { id: "x2", status: "pending", attempts: 0, dedupeKey: "handoff:A1", pipeline: "active_client", payload: {} });
    expect(await sendPendingIntents(db, { deps: { env: { ...HIST }, post: send.post } })).toEqual({ sent: 0, failed: 0 });
    expect(await sendPendingIntents(db, { deps: { env: { ...HIST, CLIENT_HANDOFF: "live" }, post: send.post } })).toEqual({ sent: 1, failed: 0 });
    expect(db.intents.map((i: any) => [i.id, i.status])).toEqual([["x1", "pending"], ["x2", "sent"]]);
  });
});

describe("B5 — trigger: onboarding stage-changed webhook", () => {
  const ENVH = { CLIENT_HANDOFF: "live", GHL_INTENT_URL_ACTIVE_CLIENT: "https://hooks.example.test/active" };
  const posts: any[] = [];
  const deps = { env: ENVH, send: { post: async (u: string, b: unknown) => (posts.push([u, b]), { ok: true, status: 200 }) } };
  beforeEach(() => { posts.length = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });
  const fire = async (db: any, stage: string) => {
    const ev = await db.ghlEvent.create({ data: { source: "stage_change", externalId: "CONTACTA1xyz", payload: { contactId: "CONTACTA1xyz", pipeline: "onboarding", stage }, receivedAt: new Date(NOW.getTime() + db.events.length * 3_600_000) } });
    return processStageChanged(ev.id, { db, deps });
  };
  const rig = (o = {}) => makeFake([member({ contactId: "CONTACTA1xyz", activeClientSince: null, onboardingProgress: "A2P Pending", billingState: "trial", ...o })], [], { writable: true });

  it("reaching A2P Approved hands off once; an earlier stage does not", async () => {
    const db = rig();
    await fire(db, "KYC Complete");
    expect(db.intents).toEqual([]);
    await fire(db, "A2P Approved");
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toMatchObject({ pipeline: "active_client", stage: "trial" });
    expect((await db.ghlAccount.findUnique({ where: { id: "A1" } })).activeClientSince).toBeInstanceOf(Date);
    expect(db.events.find((e: any) => e.payload.stage === "A2P Approved").lastError).toBeNull();
  });
  it("a redelivery (or a replay retry of the same stage) sends nothing more", async () => {
    const db = rig();
    await fire(db, "A2P Approved");
    await fire(db, "A2P Approved");
    expect(posts).toHaveLength(1);
    expect(db.intents).toHaveLength(1);
  });
  it("CLIENT_HANDOFF off: recorded as a skipped_shadow preview, nothing sent, activeClientSince stays null", async () => {
    const db = rig();
    await processStageChanged((await db.ghlEvent.create({ data: { source: "stage_change", externalId: "CONTACTA1xyz", payload: { contactId: "CONTACTA1xyz", pipeline: "onboarding", stage: "A2P Approved" } } })).id, { db, deps: { env: { CLIENT_HANDOFF: "off" } } });
    expect(posts).toEqual([]);
    expect(db.intents).toEqual([expect.objectContaining({ status: "skipped_shadow", dedupeKey: "handoff-shadow:A1" })]);
    expect((await db.ghlAccount.findUnique({ where: { id: "A1" } })).activeClientSince).toBeNull();
  });
  it("null billingState: no intent; the event notes it for review", async () => {
    const db = rig({ billingState: null });
    await fire(db, "A2P Approved");
    expect(posts).toEqual([]);
    expect(db.events.find((e: any) => e.payload?.stage === "A2P Approved").lastError).toMatch(/null billingState/);
    expect(db.events.some((e: any) => e.source === "client_handoff_review")).toBe(true);
  });
  it("a Clients-pipeline stage move never triggers a handoff", async () => {
    const db = rig();
    const ev = await db.ghlEvent.create({ data: { source: "stage_change", externalId: "CONTACTA1xyz", payload: { contactId: "CONTACTA1xyz", pipeline: "active_client", stage: "active" } } });
    await processStageChanged(ev.id, { db, deps: { ...deps, env: { ...ENVH, DUNNING_MODE: "shadow" } } });
    expect(posts).toEqual([]);
  });
});
