import { describe, expect, it } from "vitest";
import { applyDunning, applyFromLedger, dunningMode, recordShadowError, shadowDunningForLedger } from "../../state/apply";
import { hoursAgo, ledgerRow, makeFake, member, negBal, NOW, posBal } from "./_fake";

const deps = (over: Record<string, unknown> = {}) => ({ now: () => NOW, readBalance: negBal, ...over });
const failed = (id: string, at = hoursAgo(1)) => ({ ghlAccountId: "A1", trigger: `ledger:${id}`, event: { kind: "wallet_recharge_failed" as const, wallet: "auto" as const }, eventAt: at });

describe("shadow write path", () => {
  it("records a DunningDecision and touches nothing else (the fake has no GhlAccount write methods)", async () => {
    const db = makeFake([member()]);
    const r = await applyDunning(db, failed("t1"), { mode: "shadow", deps: deps() });
    expect(r.status).toBe("recorded");
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]).toMatchObject({ mode: "shadow", eventKind: "wallet_recharge_failed", fromState: "active", toState: "payment_failed", fromStrikes: 0, toStrikes: 1, trigger: "ledger:t1", balanceEstimated: false });
    expect(String(db.decisions[0].walletBalance)).toBe("-3");
  });

  it("is idempotent: the same (trigger, account, mode) is recorded once", async () => {
    const db = makeFake([member()]);
    expect((await applyDunning(db, failed("t1"), { mode: "shadow", deps: deps() })).status).toBe("recorded");
    expect((await applyDunning(db, failed("t1"), { mode: "shadow", deps: deps() })).status).toBe("duplicate");
    expect(db.decisions).toHaveLength(1);
    // a different mode is a different key
    expect((await applyDunning(db, failed("t1"), { mode: "replay", deps: deps() })).status).toBe("recorded");
    expect(db.decisions).toHaveLength(2);
  });

  it("racing duplicate inserts surface as 'duplicate', not an error (unique-constraint path)", async () => {
    const db = makeFake([member()]);
    const realCreate = db.dunningDecision.create;
    let first = true;
    db.dunningDecision.findUnique = async () => null; // both callers pass the pre-check
    db.dunningDecision.create = async (a: any) => { if (first) { first = false; return realCreate(a); } return realCreate(a); };
    const [a, b] = await Promise.all([applyDunning(db, failed("t9"), { mode: "shadow", deps: deps() }), applyDunning(db, failed("t9"), { mode: "shadow", deps: deps() })]);
    expect([a.status, b.status].sort()).toEqual(["duplicate", "recorded"]);
    expect(db.decisions).toHaveLength(1);
  });

  it("three counted strikes walk the projection: payment_failed → payment_failed → paused (non_payment) + a recorded saas_pause (never executed)", async () => {
    const db = makeFake([member()]);
    for (const [i, h] of [3, 2, 1].entries()) await applyDunning(db, failed(`s${i}`, hoursAgo(h)), { mode: "shadow", deps: deps() });
    expect(db.decisions.map((d: any) => [d.fromState, d.toState, d.toStrikes])).toEqual([["active", "payment_failed", 1], ["payment_failed", "payment_failed", 2], ["payment_failed", "paused", 3]]);
    expect(db.decisions[2].pauseReason).toBe("non_payment");
    expect(db.decisions[2].sideEffects).toEqual([{ type: "saas_pause" }]);
    expect(db.decisions[2].intents).toEqual([expect.objectContaining({ pipeline: "active_client", stage: "paused" })]);
  });

  it("reads the wallet balance only when the rule needs it", async () => {
    let reads = 0;
    const d = deps({ readBalance: async () => (reads++, { status: "ok" as const, value: "-1.000000", estimated: false }) });
    const db = makeFake([member()]);
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:ok", event: { kind: "wallet_recharge_succeeded", wallet: "auto" }, eventAt: hoursAgo(5) }, { mode: "shadow", deps: d });
    expect(reads).toBe(0); // active: a recharge success cannot cure anything, so no read
    await applyDunning(db, failed("f1", hoursAgo(4)), { mode: "shadow", deps: d });
    expect(reads).toBe(1);
    const paused = makeFake([member({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" })]);
    await applyDunning(paused, failed("f2"), { mode: "shadow", deps: d });
    expect(reads).toBe(1); // paused: no strike possible, so no read
  });

  it("a recharge success reads the post-recharge balance when it could cure, and applies the guard", async () => {
    let reads = 0;
    const ok = { ghlAccountId: "A1", trigger: "ledger:rs", event: { kind: "wallet_recharge_succeeded" as const, wallet: "auto" as const }, eventAt: hoursAgo(1) };
    const stillNegative = makeFake([member({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" })]);
    await applyDunning(stillNegative, ok, { mode: "shadow", deps: deps({ readBalance: async () => (reads++, { status: "ok" as const, value: "-0.500000", estimated: false }) }) });
    expect(reads).toBe(1);
    expect(stillNegative.decisions[0]).toMatchObject({ fromState: "paused", toState: "paused", toStrikes: 0, sideEffects: [] });
    expect(stillNegative.decisions[0].reason).toMatch(/balance still negative/);
    const cured = makeFake([member({ billingState: "paused", warningCount: 3, pauseReason: "non_payment" })]);
    await applyDunning(cured, ok, { mode: "shadow", deps: deps({ readBalance: posBal }) });
    expect(cured.decisions[0]).toMatchObject({ toState: "active", toStrikes: 0, sideEffects: [{ type: "saas_resume" }] });
  });

  it("balance unknown / non-negative: recorded, no strike", async () => {
    const unknown = makeFake([member()]);
    await applyDunning(unknown, failed("u"), { mode: "shadow", deps: deps({ readBalance: async () => ({ status: "unknown" as const, why: "wallet unavailable" }) }) });
    expect(unknown.decisions[0]).toMatchObject({ toStrikes: 0, toState: "active", walletBalance: null });
    expect(unknown.decisions[0].reason).toMatch(/balance unknown/);
    const fine = makeFake([member()]);
    await applyDunning(fine, failed("p"), { mode: "shadow", deps: deps({ readBalance: posBal }) });
    expect(fine.decisions[0]).toMatchObject({ toStrikes: 0, toState: "active" });
  });

  it("honors coreCoveredUntil for core failures", async () => {
    const db = makeFake([member({ coreCoveredUntil: new Date("2026-11-21T07:00:00Z") })]);
    await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:c", event: { kind: "core_failed" }, eventAt: hoursAgo(1) }, { mode: "shadow", deps: deps() });
    expect(db.decisions[0]).toMatchObject({ toState: "active", coreFailureOpen: false });
    expect(db.decisions[0].reason).toMatch(/covered, ignored/);
  });

  it("trial_auth reads the subscription and records the trial fields on the intent", async () => {
    const db = makeFake([member({ billingState: null })]);
    const r = await applyDunning(db, { ghlAccountId: "A1", trigger: "ledger:ta", event: { kind: "trial_auth_succeeded" }, eventAt: hoursAgo(1), subscriptionId: "sub123456789" }, { mode: "shadow", deps: deps({ readSubscription: async () => ({ name: "30 Day Trial", trialEndsAt: new Date("2026-10-25T23:05:48Z") }) }) });
    expect(r.status).toBe("recorded");
    expect(db.decisions[0]).toMatchObject({ toState: "trial" });
    expect(db.decisions[0].intents[0]).toMatchObject({ stage: "trial", fields: { trialOffer: "30 Day Trial", trialEndsAt: "2026-10-25T23:05:48.000Z" } });
  });
});

describe("projection ordering and freshness", () => {
  it("the projected state is the latest SHADOW decision by eventAt, not by insertion order", async () => {
    const db = makeFake([member()]);
    // two shadow rows inserted in the "wrong" order: the one for the NEWER event was inserted first
    await db.dunningDecision.create({ data: { ghlAccountId: "A1", trigger: "ledger:newer", mode: "shadow", eventKind: "wallet_recharge_failed", eventAt: hoursAgo(2), toState: "payment_failed", toStrikes: 2, pauseReason: null, coreFailureOpen: false, fromState: "payment_failed", fromStrikes: 1 } });
    await db.dunningDecision.create({ data: { ghlAccountId: "A1", trigger: "ledger:older", mode: "shadow", eventKind: "wallet_recharge_failed", eventAt: hoursAgo(20), toState: "payment_failed", toStrikes: 1, pauseReason: null, coreFailureOpen: false, fromState: "active", fromStrikes: 0 } });
    const next = await applyDunning(db, failed("next", hoursAgo(1)), { mode: "shadow", deps: deps() });
    expect(next.status).toBe("recorded");
    expect(db.decisions.find((d: any) => d.trigger === "ledger:next")).toMatchObject({ fromStrikes: 2, toStrikes: 3, toState: "paused" });
  });
  it("REPLAY rows never feed the shadow projection (shadow continues from the account row / its own decisions)", async () => {
    const db = makeFake([member({ billingState: "active", warningCount: 0 })]);
    // a replay decision for a NEWER event that moved the account to paused
    await applyDunning(db, failed("r1", hoursAgo(1)), { mode: "replay", deps: deps() });
    await applyDunning(db, failed("r2", hoursAgo(0.5)), { mode: "replay", deps: deps() });
    await applyDunning(db, failed("r3", hoursAgo(0.25)), { mode: "replay", deps: deps() });
    expect(db.decisions.at(-1)).toMatchObject({ mode: "replay", toState: "paused", toStrikes: 3 });
    const r = await applyDunning(db, failed("s1", hoursAgo(0.1)), { mode: "shadow", deps: deps() });
    expect(r.status).toBe("recorded"); // not "out of order" against the replay rows
    expect(db.decisions.find((d: any) => d.mode === "shadow")).toMatchObject({ fromState: "active", fromStrikes: 0, toStrikes: 1 }); // seeded from the account, not from replay
  });
  it("replay decisions continue from replay decisions, independently of shadow", async () => {
    const db = makeFake([member()]);
    await applyDunning(db, failed("s1", hoursAgo(3)), { mode: "shadow", deps: deps() });
    await applyDunning(db, failed("r1", hoursAgo(90)), { mode: "replay", deps: deps() });
    await applyDunning(db, failed("r2", hoursAgo(80)), { mode: "replay", deps: deps() });
    expect(db.decisions.filter((d: any) => d.mode === "replay").map((d: any) => d.toStrikes)).toEqual([1, 2]);
  });
  it("shadow skips an event older than an already-projected one (out of order)", async () => {
    const db = makeFake([member()]);
    await applyDunning(db, failed("late", hoursAgo(1)), { mode: "shadow", deps: deps() });
    const r = await applyDunning(db, failed("early", hoursAgo(5)), { mode: "shadow", deps: deps() });
    expect(r).toMatchObject({ status: "skipped", why: expect.stringMatching(/out of order/) });
    expect(db.decisions).toHaveLength(1);
  });
  it("shadow skips historical events (>48h) — replay covers history; replay mode does not", async () => {
    const db = makeFake([member()]);
    expect(await applyDunning(db, failed("h", hoursAgo(72)), { mode: "shadow", deps: deps() })).toMatchObject({ status: "skipped", why: expect.stringMatching(/historical/) });
    expect((await applyDunning(db, failed("h", hoursAgo(72)), { mode: "replay", deps: deps() })).status).toBe("recorded");
  });
  it("seeds from the account row when there is no decision yet", async () => {
    const db = makeFake([member({ billingState: "payment_failed", warningCount: 2 })]);
    await applyDunning(db, failed("seed"), { mode: "shadow", deps: deps() });
    expect(db.decisions[0]).toMatchObject({ fromState: "payment_failed", fromStrikes: 2, toStrikes: 3, toState: "paused" });
  });
});

describe("skips", () => {
  it("non-member and unknown accounts", async () => {
    const db = makeFake([member({ id: "OWNER", accountType: "internal" })]);
    expect(await applyDunning(db, { ...failed("x"), ghlAccountId: "OWNER" }, { mode: "shadow", deps: deps() })).toMatchObject({ status: "skipped", why: "not a member account" });
    expect(await applyDunning(db, { ...failed("x"), ghlAccountId: "NOPE" }, { mode: "shadow", deps: deps() })).toMatchObject({ status: "skipped" });
    expect(db.decisions).toHaveLength(0);
  });
  it("ledger rows: pending, unmatched and rule-less classes are skipped WITHOUT recording", async () => {
    const db = makeFake([member()], [ledgerRow({ ghlTransactionId: "p", status: "pending" }), ledgerRow({ ghlTransactionId: "u", ghlAccountId: null }), ledgerRow({ ghlTransactionId: "fs", classification: "failed_signup" })]);
    for (const id of ["p", "u", "fs", "missing"]) expect((await applyFromLedger(db, id, { mode: "shadow", deps: deps() })).status).toBe("skipped");
    expect(db.decisions).toHaveLength(0);
  });
  it("a ledger row that later becomes terminal is decided then (pending did not freeze the key)", async () => {
    const ledger = [ledgerRow({ ghlTransactionId: "t", status: "pending" })];
    const db = makeFake([member()], ledger);
    expect((await applyFromLedger(db, "t", { mode: "shadow", deps: deps() })).status).toBe("skipped");
    ledger[0].status = "failed";
    expect((await applyFromLedger(db, "t", { mode: "shadow", deps: deps() })).status).toBe("recorded");
    expect(db.decisions[0].trigger).toBe("ledger:t");
  });
});

describe("modes", () => {
  it("DUNNING_MODE defaults to shadow; any other value throws", () => {
    expect(dunningMode({})).toBe("shadow");
    expect(dunningMode({ DUNNING_MODE: "shadow" })).toBe("shadow");
    for (const v of ["live", "replay", "off", ""]) if (v !== "") expect(() => dunningMode({ DUNNING_MODE: v })).toThrow(/not supported/);
  });
  it("the live branch is a stub that throws and writes nothing", async () => {
    const db = makeFake([member()]);
    await expect(applyDunning(db, failed("l"), { mode: "live", deps: deps() })).rejects.toThrow(/not implemented/);
    expect(db.decisions).toHaveLength(0);
  });
});

describe("the ingest hook never throws", () => {
  it("swallows a database failure, logs it, and records it for the admin Health page", async () => {
    const db = makeFake([member()], [ledgerRow({})]);
    db.billingLedgerEntry.findUnique = async () => { throw new Error("db exploded"); };
    const r = await shadowDunningForLedger(db, "tx1", { deps: deps() });
    expect(r).toBeNull();
    expect(db.jobRuns.get("dunning_shadow")).toMatchObject({ lastError: expect.stringMatching(/db exploded/), lastSummary: { errors: 1 } });
    await shadowDunningForLedger(db, "tx1", { deps: deps() });
    expect(db.jobRuns.get("dunning_shadow").lastSummary.errors).toBe(2);
  });
  it("an unsupported DUNNING_MODE is contained too (no throw out of the hook)", async () => {
    const prev = process.env.DUNNING_MODE;
    process.env.DUNNING_MODE = "live";
    try {
      const db = makeFake([member()], [ledgerRow({})]);
      await expect(shadowDunningForLedger(db, "tx1", { deps: deps() })).resolves.toBeNull();
      expect(db.decisions).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.DUNNING_MODE; else process.env.DUNNING_MODE = prev;
    }
  });
  it("even a broken error recorder does not throw", async () => {
    await expect(recordShadowError({ jobRun: { findUnique: async () => { throw new Error("no"); } } } as any, new Error("x"), "w")).resolves.toBeUndefined();
  });
  it("a normal ledger row goes through end to end", async () => {
    const db = makeFake([member()], [ledgerRow({})]);
    const r = await shadowDunningForLedger(db, "tx1", { deps: deps() });
    expect(r?.status).toBe("recorded");
    expect(db.decisions[0]).toMatchObject({ trigger: "ledger:tx1", toState: "payment_failed" });
  });
});
