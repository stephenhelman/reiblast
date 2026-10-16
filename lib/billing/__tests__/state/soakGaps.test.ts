import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../db", () => ({ getBillingDb: async () => holder.db }));

import { POST as stageChanged } from "@/app/api/webhooks/ghl/stage-changed/route";
import { handoffToClients } from "../../clientHandoff";
import { planCatchup, runCatchup } from "../../handoffCatchup";
import { applyDunning } from "../../state/apply";
import { decide } from "../../state/transition";
import type { Context, DunningEvent, Snapshot } from "../../state/types";
import { eventForStage } from "../../events/stageChanged";
import { CLIENTS_STAGE_NAME_TO_STATE } from "../../stages";
import { hoursAgo, makeFake, member, NOW } from "./_fake";

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ state: "active", strikes: 0, pauseReason: null, coreFailureOpen: false, ...o });
const ctx = (o: Partial<Context> = {}): Context => ({ now: NOW, coveredUntil: null, ...o });
const expired: DunningEvent = { kind: "subscription_expired" };
const coreOk: DunningEvent = { kind: "core_succeeded" };
const stages = (d: ReturnType<typeof decide>) => d.intents.map((i) => `${i.pipeline}:${i.stage}`);

describe("1. Expired Sub", () => {
  it("subscription_expired → payment_failed with reason subscription_expired (not churned), no pause, Clients expired_sub intent", () => {
    for (const state of ["trial", "active", "payment_failed", null] as const) {
      const d = decide(snap({ state, pauseReason: null }), expired, ctx());
      expect(d).toMatchObject({ nextState: "payment_failed", pauseReason: "subscription_expired", coreFailureOpen: true });
      expect(d.sideEffects).toEqual([]);
      expect(stages(d)).toEqual(["active_client:expired_sub"]);
    }
  });
  it("only a canceled subscription churns", () => {
    expect(decide(snap(), { kind: "subscription_canceled", duringTrial: false }, ctx()).nextState).toBe("churned");
    expect(decide(snap(), expired, ctx()).nextState).not.toBe("churned");
  });
  it("an onboarding member with an expired subscription goes to Onboarding Payment Failed", () => {
    const d = decide(snap(), expired, ctx({ routing: { handedOff: false, onboardingProgress: "KYC Complete" } }));
    expect(d.nextState).toBe("payment_failed");
    expect(stages(d)).toEqual(["onboarding:payment_failed"]);
  });
  it("already expired = no change; covered = deferred; paused/inactive/churned are not moved", () => {
    expect(decide(snap({ state: "payment_failed", pauseReason: "subscription_expired", coreFailureOpen: true }), expired, ctx()).noop).toBe(true);
    expect(decide(snap(), expired, ctx({ coveredUntil: new Date(NOW.getTime() + 864e5) })).noop).toBe(true);
    expect(decide(snap({ state: "paused", pauseReason: "manual_killswitch" }), expired, ctx()).nextState).toBe("paused");
    expect(decide(snap({ state: "inactive" }), expired, ctx()).nextState).toBe("inactive");
    expect(decide(snap({ state: "churned" }), expired, ctx()).nextState).toBe("churned");
  });
  it("a succeeded core payment cures an expired_sub account to active and drops the reason; a wallet recharge does not", () => {
    const s = snap({ state: "payment_failed", pauseReason: "subscription_expired", coreFailureOpen: true });
    const cured = decide(s, coreOk, ctx());
    expect(cured).toMatchObject({ nextState: "active", pauseReason: null, coreFailureOpen: false });
    expect(stages(cured)).toEqual(["active_client:active"]);
    const wallet = decide(s, { kind: "wallet_recharge_succeeded", wallet: "auto" }, ctx({ walletBalance: { status: "ok", value: "5", estimated: false } }));
    expect(wallet.nextState).toBe("payment_failed");
    // onboarding member: cured back to the progress stage
    expect(stages(decide(s, coreOk, ctx({ routing: { handedOff: false, onboardingProgress: "KYC Complete" } })))).toEqual(["onboarding:kyc_complete"]);
  });
  it("the stage 'Expired Sub' is a known Clients stage mapping to payment_failed, and parses to the expired_sub command (name and key)", () => {
    expect(CLIENTS_STAGE_NAME_TO_STATE["Expired Sub"]).toBe("payment_failed");
    expect(eventForStage("Expired Sub")).toEqual({ kind: "command", stage: "expired_sub" });
    expect(eventForStage("expired_sub")).toEqual({ kind: "command", stage: "expired_sub" });
  });
  it("manual move to Expired Sub = payment_failed / subscription_expired, no pause, no side effects; repeating it is a confirmation", () => {
    const cmd: DunningEvent = { kind: "command", stage: "expired_sub" };
    for (const state of ["active", "trial", "payment_failed"] as const) {
      const d = decide(snap({ state }), cmd, ctx());
      expect(d).toMatchObject({ nextState: "payment_failed", pauseReason: "subscription_expired" });
      expect(d.sideEffects).toEqual([]);
    }
    const again = decide(snap({ state: "payment_failed", pauseReason: "subscription_expired", coreFailureOpen: true }), cmd, ctx());
    expect(again.noop).toBe(true);
    expect(again.sideEffects).toEqual([]);
  });

  beforeEach(() => {
    process.env.GHL_EVENTS_SECRET = "s";
    delete process.env.DUNNING_MODE;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  it("route: the stage name 'Expired Sub' arriving via stage-changed is that command", async () => {
    holder.db = makeFake([member({ contactId: "CONTACTAA1x", billingState: "active" })], [], { writable: true });
    await post({ contactId: "CONTACTAA1x", pipeline: "active_client", stage: "Expired Sub" });
    expect(holder.db.decisions[0]).toMatchObject({ eventKind: "command", toState: "payment_failed", pauseReason: "subscription_expired", sideEffects: [] });
    expect(holder.db.events[0].lastError).toBeNull();
  });
  it("the handoff places a payment_failed/subscription_expired member in Expired Sub", async () => {
    const db = makeFake([member({ activeClientSince: null, billingState: "payment_failed", pauseReason: "subscription_expired" })], [], { writable: true });
    const r = await handoffToClients(db, "A1", { env: { CLIENT_HANDOFF: "off" } });
    expect(r).toMatchObject({ status: "shadow", stage: "expired_sub" });
  });
});

const post = (body: unknown) =>
  stageChanged(new NextRequest("https://example.test/api/webhooks/ghl/stage-changed", { method: "POST", headers: { "content-type": "application/json", "x-reiblast-events-secret": "s" }, body: JSON.stringify(body) }));

describe("2. starting-state seeding in shadow mode", () => {
  const deps = { now: () => NOW };
  const trialAuth = { ghlAccountId: "A1", trigger: "ledger:ta", event: { kind: "trial_auth_succeeded" } as DunningEvent, eventAt: hoursAgo(1), subscriptionId: "sub123456789" };
  it("trial_auth on a null account writes trial + offer + end date for real, in shadow, with no side effects and only the normal intents", async () => {
    const db = makeFake([member({ billingState: null, activeClientSince: null })]);
    const r = await applyDunning(db, trialAuth, { mode: "shadow", deps: { ...deps, readSubscription: async () => ({ name: "30 Day Trial", trialEndsAt: new Date("2026-10-25T00:00:00Z") }) } });
    expect(r.status).toBe("recorded");
    const a = db.accounts?.[0] ?? (await db.ghlAccount.findUnique({ where: { id: "A1" } }));
    expect(a).toMatchObject({ billingState: "trial", trialOffer: "30 Day Trial", trialEndsAt: new Date("2026-10-25T00:00:00Z") });
    expect(db.decisions[0].sideEffects).toEqual([]);
    expect(db.intents.every((i: any) => i.status === "skipped_shadow")).toBe(true);
  });
  it("a first core payment seeds active; a core failure seeds payment_failed", async () => {
    const ok = makeFake([member({ billingState: null })]);
    await applyDunning(ok, { ghlAccountId: "A1", trigger: "ledger:c1", event: { kind: "core_succeeded" }, eventAt: hoursAgo(1) }, { mode: "shadow", deps });
    expect((await ok.ghlAccount.findUnique({ where: { id: "A1" } })).billingState).toBe("active");
    const bad = makeFake([member({ billingState: null })]);
    await applyDunning(bad, { ghlAccountId: "A1", trigger: "ledger:c2", event: { kind: "core_failed" }, eventAt: hoursAgo(1) }, { mode: "shadow", deps });
    expect((await bad.ghlAccount.findUnique({ where: { id: "A1" } })).billingState).toBe("payment_failed");
  });
  it("an expired subscription on a null account seeds payment_failed with the subscription_expired reason", async () => {
    const db = makeFake([member({ billingState: null })]);
    await applyDunning(db, { ghlAccountId: "A1", trigger: "sub:S:expired", event: expired, eventAt: hoursAgo(1) }, { mode: "shadow", deps });
    expect(await db.ghlAccount.findUnique({ where: { id: "A1" } })).toMatchObject({ billingState: "payment_failed", pauseReason: "subscription_expired" });
  });
  it("NEVER overwrites a non-null state in shadow", async () => {
    const db = makeFake([member({ billingState: "paused", pauseReason: "manual_killswitch" })]);
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:c3", event: { kind: "core_succeeded" }, eventAt: hoursAgo(1) }, { mode: "shadow", deps });
    expect(await db.ghlAccount.findUnique({ where: { id: "A1" } })).toMatchObject({ billingState: "paused", pauseReason: "manual_killswitch" });
    expect(db.writes).toEqual([]);
  });
  it("wallet events do not seed", async () => {
    const db = makeFake([member({ billingState: null })]);
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:w", event: { kind: "wallet_recharge_failed", wallet: "auto" }, eventAt: hoursAgo(1) }, { mode: "shadow", deps: { ...deps, readBalance: async () => ({ status: "ok", value: "-3", estimated: false }) } });
    expect((await db.ghlAccount.findUnique({ where: { id: "A1" } })).billingState).toBeNull();
  });
  it("replay never seeds", async () => {
    const db = makeFake([member({ billingState: null })]);
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:r", event: { kind: "core_succeeded" }, eventAt: hoursAgo(1) }, { mode: "replay", deps });
    expect((await db.ghlAccount.findUnique({ where: { id: "A1" } })).billingState).toBeNull();
  });
});

describe("2b. handoff catch-up", () => {
  const review = (id: string) => ({ source: "client_handoff_review", externalId: `c-${id}`, payload: { ghlAccountId: id } });
  const setup = () => {
    const db = makeFake(
      [
        member({ id: "R1", contactId: "CONTACT_R1", billingState: "active", activeClientSince: null, onboardingProgress: "A2P Approved" }), // seeded since
        member({ id: "R2", contactId: "CONTACT_R2", billingState: null, activeClientSince: null, onboardingProgress: "A2P Approved" }), // still null
        member({ id: "R3", contactId: "CONTACT_R3", billingState: "payment_failed", pauseReason: "subscription_expired", activeClientSince: null, onboardingProgress: "A2P Approved" }),
        member({ id: "R4", contactId: "CONTACT_R4", billingState: "active", activeClientSince: new Date("2026-10-01T00:00:00Z"), onboardingProgress: "A2P Approved" }), // already handed off
      ],
      [],
      { writable: true },
    );
    for (const id of ["R1", "R2", "R3", "R4"]) db.events.push({ id: `e-${id}`, ...review(id) });
    return db;
  };
  it("the plan reports who would be handed off and where, and writes nothing", async () => {
    const db = setup();
    const plan = await planCatchup(db);
    expect(plan.map((p) => [p.ghlAccountId, p.status, p.stage])).toEqual([["R1", "ready", "active"], ["R2", "unseeded", null], ["R3", "ready", "expired_sub"]]);
    expect(db.intents).toHaveLength(0);
    expect(db.writes).toEqual([]);
  });
  it("apply refuses unless CLIENT_HANDOFF=live; with live it hands off the seeded accounts only", async () => {
    const db = setup();
    await expect(runCatchup(db, { env: {} })).rejects.toThrow(/CLIENT_HANDOFF/);
    expect(db.intents).toHaveLength(0);
    const sent: unknown[] = [];
    const { results } = await runCatchup(db, { env: { CLIENT_HANDOFF: "live", GHL_INTENT_URL_ACTIVE_CLIENT: "https://x.test/h" }, send: { post: async (_u: string, b: unknown) => (sent.push(b), { ok: true, status: 200 }), sleep: async () => {} } });
    expect(results.map((r) => [r.ghlAccountId, r.result.status])).toEqual([["R1", "handed_off"], ["R3", "handed_off"]]);
    expect(sent.map((b: any) => b.stage)).toEqual(["active", "expired_sub"]);
    expect((await db.ghlAccount.findUnique({ where: { id: "R2" } })).activeClientSince).toBeNull();
    // idempotent: a second run has nothing left to do for R1/R3
    expect((await planCatchup(db)).map((p) => p.ghlAccountId)).toEqual(["R2"]);
  });
});

describe("3. Onboarding side-stage moves are engine commands (progress untouched)", () => {
  const C = "CONTACTOB1x";
  const onb = (o = {}) => member({ contactId: C, billingState: "active", activeClientSince: null, onboardingProgress: "KYC Complete", onboardingStage: "KYC Complete", ...o });
  it('"Paused" = manual_killswitch pause + saas_pause; onboardingProgress unchanged', async () => {
    holder.db = makeFake([onb()], [], { writable: true });
    await post({ contactId: C, pipeline: "onboarding", stage: "Paused" });
    expect(holder.db.decisions[0]).toMatchObject({ eventKind: "command", toState: "paused", pauseReason: "manual_killswitch", sideEffects: [{ type: "saas_pause" }] });
    const a = await holder.db.ghlAccount.findUnique({ where: { id: "A1" } });
    expect(a.onboardingProgress).toBe("KYC Complete");
    expect(a.onboardingStage).toBe("Paused");
  });
  it('"Payment Failed" is routed to the same command as the Clients stage of that name and never moves progress', async () => {
    holder.db = makeFake([onb()], [], { writable: true });
    await post({ contactId: C, pipeline: "onboarding", stage: "Payment Failed" });
    expect(holder.db.decisions[0]).toMatchObject({ eventKind: "command", trigger: expect.stringMatching(/^command:payment_failed:/) });
    expect((await holder.db.ghlAccount.findUnique({ where: { id: "A1" } })).onboardingProgress).toBe("KYC Complete");
  });
  it("progress stages stay progress-only (no decision), and a handed-off member's Onboarding side-stage move is not a command", async () => {
    holder.db = makeFake([onb()], [], { writable: true });
    await post({ contactId: C, pipeline: "onboarding", stage: "A2P Pending" });
    expect(holder.db.decisions).toHaveLength(0);
    expect((await holder.db.ghlAccount.findUnique({ where: { id: "A1" } })).onboardingProgress).toBe("A2P Pending");
    holder.db = makeFake([onb({ activeClientSince: new Date("2026-10-01T00:00:00Z") })], [], { writable: true });
    await post({ contactId: C, pipeline: "onboarding", stage: "Paused" });
    expect(holder.db.decisions).toHaveLength(0);
  });
  it("the engine's own echo (state already paused) is a confirmation: no second pause", async () => {
    holder.db = makeFake([onb({ billingState: "paused", pauseReason: "non_payment" })], [], { writable: true });
    await post({ contactId: C, pipeline: "onboarding", stage: "Paused" });
    expect(holder.db.decisions[0]).toMatchObject({ toState: "paused", pauseReason: "non_payment", sideEffects: [] });
  });
});
