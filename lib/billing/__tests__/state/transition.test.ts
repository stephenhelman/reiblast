import { describe, expect, it } from "vitest";
import { decide, needsBalance, needsSubscription } from "../../state/transition";
import type { BalanceReading, BillingState, Context, DunningEvent, PauseReason, Snapshot } from "../../state/types";

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ state: "active", strikes: 0, pauseReason: null, coreFailureOpen: false, ...o });
const NOW = new Date("2026-09-27T12:00:00.000Z");
const neg: BalanceReading = { status: "ok", value: "-5.000000", estimated: false };
const pos: BalanceReading = { status: "ok", value: "12.500000", estimated: false };
const ctx = (o: Partial<Context> = {}): Context => ({ now: NOW, coveredUntil: null, ...o });
const wFail: DunningEvent = { kind: "wallet_recharge_failed", wallet: "auto" };
const wOk: DunningEvent = { kind: "wallet_recharge_succeeded", wallet: "auto" };
const stages = (d: ReturnType<typeof decide>) => d.intents.map((i) => i.stage);
const effects = (d: ReturnType<typeof decide>) => d.sideEffects.map((e) => e.type + (e.idempotent ? "*" : ""));

describe("wallet recharge FAILURE", () => {
  it("balance < 0 is a strike: active → payment_failed, strike 1", () => {
    const d = decide(snap(), wFail, ctx({ walletBalance: neg }));
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 1, pauseReason: null, noop: false });
    expect(stages(d)).toEqual(["payment_failed"]);
    expect(d.sideEffects).toEqual([]);
    expect(d.reason).toMatch(/strike 1 of 3/);
  });
  it("trial → payment_failed as well", () => expect(decide(snap({ state: "trial" }), wFail, ctx({ walletBalance: neg }))).toMatchObject({ nextState: "payment_failed", warningCount: 1 }));
  it("unseeded (null) state is treated like active", () => expect(decide(snap({ state: null }), wFail, ctx({ walletBalance: neg }))).toMatchObject({ nextState: "payment_failed", warningCount: 1 }));
  it("strike 2 stays payment_failed (no new stage intent)", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 1 }), wFail, ctx({ walletBalance: neg }));
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 2 });
    expect(d.intents).toEqual([]);
    expect(d.sideEffects).toEqual([]);
  });
  it("the 3rd strike pauses (non_payment) with a paused intent AND saas_pause in the same decision (no confirmation step)", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 2 }), wFail, ctx({ walletBalance: neg }));
    expect(d).toMatchObject({ nextState: "paused", pauseReason: "non_payment", warningCount: 3 });
    expect(effects(d)).toEqual(["saas_pause"]);
    expect(stages(d)).toEqual(["paused"]);
    expect(d.intents[0]).toMatchObject({ pipeline: "active_client", fields: { warningCount: 3, pauseReason: "non_payment" } });
    expect(d.reason).toMatch(/strike 3 of 3/);
  });
  it("balance >= 0 is recorded but changes nothing (no strike)", () => {
    for (const value of ["0.000000", "12.500000"]) {
      const d = decide(snap({ strikes: 1, state: "payment_failed" }), wFail, ctx({ walletBalance: { status: "ok", value, estimated: false } }));
      expect(d.noop).toBe(true);
      expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 1 });
      expect(d.reason).toMatch(/no strike/);
    }
  });
  it("unknown / unread balance: strike not counted", () => {
    const d = decide(snap(), wFail, ctx({ walletBalance: { status: "unknown", why: "wallet unavailable" } }));
    expect(d.noop).toBe(true);
    expect(d.warningCount).toBe(0);
    expect(d.reason).toMatch(/balance unknown \(wallet unavailable\); strike not counted/);
    expect(decide(snap(), wFail, ctx()).reason).toMatch(/balance unknown; strike not counted/);
  });
  it("an estimated balance is labelled 'estimated' in the reason", () => {
    expect(decide(snap(), wFail, ctx({ walletBalance: { status: "ok", value: "-2.000000", estimated: true } })).reason).toMatch(/\(estimated\)/);
  });
  it("manual recharge failures count the same as auto", () => {
    expect(decide(snap(), { kind: "wallet_recharge_failed", wallet: "manual" }, ctx({ walletBalance: neg }))).toMatchObject({ warningCount: 1 });
  });
  it("an already-paused account is never struck further, whatever the reason", () => {
    for (const pauseReason of ["non_payment", "expired_invoice", "manual_killswitch", "voluntary"] as PauseReason[]) {
      const d = decide(snap({ state: "paused", strikes: 3, pauseReason }), wFail, ctx({ walletBalance: neg }));
      expect(d).toMatchObject({ nextState: "paused", warningCount: 3, noop: true });
    }
  });
  it("a strike never touches the open-core-failure flag", () => {
    expect(decide(snap({ coreFailureOpen: true, state: "payment_failed" }), wFail, ctx({ walletBalance: neg })).coreFailureOpen).toBe(true);
  });
});

describe("wallet recharge SUCCESS (resume guard: only cures when the post-recharge balance is >= 0)", () => {
  const zero: BalanceReading = { status: "ok", value: "0.000000", estimated: false };
  const est: BalanceReading = { status: "ok", value: "-1.500000", estimated: true };
  const unknown: BalanceReading = { status: "unknown", why: "wallet unavailable" };

  it("balance >= 0: strikes reset; payment_failed → active when no core failure is open", () => {
    for (const balance of [pos, zero]) {
      const d = decide(snap({ state: "payment_failed", strikes: 2 }), wOk, ctx({ walletBalance: balance }));
      expect(d).toMatchObject({ nextState: "active", warningCount: 0, noop: false });
      expect(stages(d)).toEqual(["active"]);
      expect(d.sideEffects).toEqual([]); // not paused, so nothing to resume
    }
  });
  it("balance still NEGATIVE: strikes reset but payment_failed stays, with the stated reason", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 2 }), wOk, ctx({ walletBalance: neg }));
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 0, noop: false });
    expect(d.intents).toEqual([]);
    expect(d.sideEffects).toEqual([]);
    expect(d.reason).toMatch(/recharge succeeded, balance still negative/);
    expect(decide(snap({ state: "payment_failed", strikes: 2 }), wOk, ctx({ walletBalance: est })).reason).toMatch(/still negative \(-1\.500000 \(estimated\)\)/);
  });
  it("balance UNKNOWN is 'not confirmed': strikes reset, state stays", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 1 }), wOk, ctx({ walletBalance: unknown }));
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 0 });
    expect(d.reason).toMatch(/balance unknown \(wallet unavailable\)/);
    expect(decide(snap({ state: "payment_failed", strikes: 1 }), wOk, ctx()).nextState).toBe("payment_failed"); // never read
  });
  it("stays payment_failed while an unpaid core failure is open — whatever the balance (strikes still reset)", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 2, coreFailureOpen: true }), wOk, ctx({ walletBalance: pos }));
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 0, coreFailureOpen: true });
    expect(d.intents).toEqual([]);
    expect(d.reason).toMatch(/core failure still open/);
  });
  it("paused (non_payment) + balance >= 0 → active with saas_resume and strikes reset", () => {
    const d = decide(snap({ state: "paused", strikes: 3, pauseReason: "non_payment" }), wOk, ctx({ walletBalance: pos }));
    expect(d).toMatchObject({ nextState: "active", warningCount: 0, pauseReason: null });
    expect(effects(d)).toEqual(["saas_resume"]);
    expect(stages(d)).toEqual(["active"]);
  });
  it("paused (non_payment) + balance still negative or unknown → stays paused, no resume, strikes reset", () => {
    for (const balance of [neg, est, unknown, undefined]) {
      const d = decide(snap({ state: "paused", strikes: 3, pauseReason: "non_payment" }), wOk, ctx({ walletBalance: balance }));
      expect(d).toMatchObject({ nextState: "paused", pauseReason: "non_payment", warningCount: 0 });
      expect(d.sideEffects).toEqual([]);
      expect(d.intents).toEqual([]);
      expect(d.reason).toMatch(/recharge succeeded, balance (still negative|unknown)/);
    }
  });
  it("paused (non_payment) with an open core failure resumes into payment_failed once the balance is >= 0", () => {
    const d = decide(snap({ state: "paused", strikes: 3, pauseReason: "non_payment", coreFailureOpen: true }), wOk, ctx({ walletBalance: pos }));
    expect(d).toMatchObject({ nextState: "payment_failed", pauseReason: null, warningCount: 0 });
    expect(effects(d)).toEqual(["saas_resume"]);
  });
  it("paused for any OTHER reason is never resumed by a wallet recharge, even with a positive balance (strikes still reset)", () => {
    for (const pauseReason of ["expired_invoice", "manual_killswitch", "voluntary"] as PauseReason[]) {
      const d = decide(snap({ state: "paused", strikes: 1, pauseReason }), wOk, ctx({ walletBalance: pos }));
      expect(d).toMatchObject({ nextState: "paused", pauseReason, warningCount: 0 });
      expect(d.sideEffects).toEqual([]);
    }
  });
  it("active / trial: strikes reset with no balance needed", () => {
    expect(decide(snap(), wOk, ctx()).noop).toBe(true);
    expect(decide(snap({ state: "trial", strikes: 1 }), wOk, ctx({ walletBalance: neg }))).toMatchObject({ nextState: "trial", warningCount: 0, noop: false });
    expect(decide(snap({ state: "active", strikes: 2 }), wOk, ctx())).toMatchObject({ nextState: "active", warningCount: 0 });
  });
});

describe("core subscription FAILURE", () => {
  const cFail: DunningEvent = { kind: "core_failed" };
  it("→ payment_failed with NO strike, and the core failure is now open", () => {
    const d = decide(snap(), cFail, ctx());
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 0, coreFailureOpen: true });
    expect(stages(d)).toEqual(["payment_failed"]);
  });
  it("repeated core failures never add strikes", () => {
    let s = snap();
    for (let i = 0; i < 5; i++) { const d = decide(s, cFail, ctx()); s = { ...s, state: d.nextState, strikes: d.warningCount, coreFailureOpen: d.coreFailureOpen }; }
    expect(s).toMatchObject({ state: "payment_failed", strikes: 0, coreFailureOpen: true });
  });
  it("trial → payment_failed too", () => expect(decide(snap({ state: "trial" }), cFail, ctx()).nextState).toBe("payment_failed"));
  it("while covered (now < coreCoveredUntil): recorded as 'covered, ignored', nothing changes", () => {
    const d = decide(snap(), cFail, ctx({ coveredUntil: new Date("2026-11-21T07:00:00Z") }));
    expect(d.noop).toBe(true);
    expect(d).toMatchObject({ nextState: "active", coreFailureOpen: false });
    expect(d.reason).toMatch(/covered, ignored/);
  });
  it("coverage is evaluated at ctx.now: it protects until the end, not after", () => {
    const until = new Date("2026-11-21T07:00:00Z");
    expect(decide(snap(), cFail, ctx({ now: new Date("2026-11-21T06:59:59Z"), coveredUntil: until })).noop).toBe(true);
    expect(decide(snap(), cFail, ctx({ now: new Date("2026-11-21T07:00:00Z"), coveredUntil: until })).nextState).toBe("payment_failed"); // exclusive end
  });
  it("an already-paused account just records the open failure", () => {
    const d = decide(snap({ state: "paused", pauseReason: "non_payment", strikes: 3 }), cFail, ctx());
    expect(d).toMatchObject({ nextState: "paused", coreFailureOpen: true, warningCount: 3 });
    expect(d.intents).toEqual([]);
  });
});

describe("expired invoice", () => {
  const inv: DunningEvent = { kind: "invoice_expired", invoiceId: "inv_1" };
  it("→ paused (expired_invoice) with a paused intent AND saas_pause in the same decision", () => {
    const d = decide(snap(), inv, ctx());
    expect(d).toMatchObject({ nextState: "paused", pauseReason: "expired_invoice", coreFailureOpen: true, warningCount: 0 });
    expect(effects(d)).toEqual(["saas_pause"]);
    expect(stages(d)).toEqual(["paused"]);
  });
  it("from payment_failed and trial as well; strikes unchanged", () => {
    expect(decide(snap({ state: "payment_failed", strikes: 2 }), inv, ctx())).toMatchObject({ nextState: "paused", warningCount: 2 });
    expect(decide(snap({ state: "trial" }), inv, ctx()).nextState).toBe("paused");
  });
  it("coverage protects it too", () => {
    const d = decide(snap(), inv, ctx({ coveredUntil: new Date("2026-11-21T07:00:00Z") }));
    expect(d.noop).toBe(true);
    expect(d.reason).toMatch(/covered, ignored/);
  });
  it("already paused: no change to the pause, no second side effect", () => {
    const d = decide(snap({ state: "paused", pauseReason: "manual_killswitch" }), inv, ctx());
    expect(d).toMatchObject({ nextState: "paused", pauseReason: "manual_killswitch" });
    expect(d.sideEffects).toEqual([]);
  });
});

describe("core subscription SUCCESS", () => {
  const cOk: DunningEvent = { kind: "core_succeeded" };
  it("reactivates a pause caused by an expired invoice", () => {
    const d = decide(snap({ state: "paused", pauseReason: "expired_invoice", coreFailureOpen: true }), cOk, ctx());
    expect(d).toMatchObject({ nextState: "active", pauseReason: null, coreFailureOpen: false, warningCount: 0 });
    expect(effects(d)).toEqual(["saas_resume"]);
  });
  it("reactivates a non_payment pause (and clears its strikes)", () => {
    const d = decide(snap({ state: "paused", pauseReason: "non_payment", strikes: 3 }), cOk, ctx());
    expect(d).toMatchObject({ nextState: "active", pauseReason: null, warningCount: 0 });
    expect(effects(d)).toEqual(["saas_resume"]);
  });
  it("does NOT resume manual_killswitch / voluntary / unknown-reason pauses", () => {
    for (const pauseReason of ["manual_killswitch", "voluntary", null] as (PauseReason | null)[]) {
      const d = decide(snap({ state: "paused", pauseReason, coreFailureOpen: true }), cOk, ctx());
      expect(d).toMatchObject({ nextState: "paused", pauseReason, coreFailureOpen: false });
      expect(d.sideEffects).toEqual([]);
    }
  });
  it("trial → active; unseeded → active", () => {
    expect(decide(snap({ state: "trial" }), cOk, ctx())).toMatchObject({ nextState: "active" });
    expect(decide(snap({ state: null }), cOk, ctx())).toMatchObject({ nextState: "active" });
  });
  it("payment_failed → active and clears the core failure", () => {
    const d = decide(snap({ state: "payment_failed", coreFailureOpen: true }), cOk, ctx());
    expect(d).toMatchObject({ nextState: "active", coreFailureOpen: false });
    expect(stages(d)).toEqual(["active"]);
  });
  it("…but payment_failed stays while wallet strikes are open (only the core flag clears)", () => {
    const d = decide(snap({ state: "payment_failed", strikes: 2, coreFailureOpen: true }), cOk, ctx());
    expect(d).toMatchObject({ nextState: "payment_failed", warningCount: 2, coreFailureOpen: false });
    expect(d.intents).toEqual([]);
  });
  it("active + no open failure is a no-op", () => expect(decide(snap(), cOk, ctx()).noop).toBe(true));
});

describe("trial_auth", () => {
  const sub = (name: string | null, end = "2026-10-25T23:05:48.000Z") => ({ name, trialEndsAt: new Date(end) });
  const ta: DunningEvent = { kind: "trial_auth_succeeded" };
  it("null → trial with offer and end from the subscription", () => {
    const d = decide(snap({ state: null }), ta, ctx({ subscription: sub("30 Day Trial") }));
    expect(d).toMatchObject({ nextState: "trial", trialOffer: "30 Day Trial", trialChanged: true });
    expect(d.trialEndsAt?.toISOString()).toBe("2026-10-25T23:05:48.000Z");
    expect(d.intents[0]).toMatchObject({ stage: "trial", fields: { trialOffer: "30 Day Trial", trialEndsAt: "2026-10-25T23:05:48.000Z" } });
  });
  it("offer only when the name matches /\\d+\\s*Day Trial/i", () => {
    expect(decide(snap({ state: null }), ta, ctx({ subscription: sub("7 day trial") })).trialOffer).toBe("7 day trial");
    expect(decide(snap({ state: null }), ta, ctx({ subscription: sub("14  Day Trial Special") })).trialOffer).toBe("14  Day Trial Special");
    for (const name of ["Core Plan", "Trial", "Day Trial", null]) {
      const d = decide(snap({ state: null }), ta, ctx({ subscription: sub(name) }));
      expect(d.trialOffer).toBeNull();
      expect(d.nextState).toBe("trial");
      expect(d.trialEndsAt).not.toBeNull(); // the end date is still taken from the subscription
    }
  });
  it("subscription unavailable → still trial, offer/end unknown", () => {
    const d = decide(snap({ state: null }), ta, ctx({ subscription: null }));
    expect(d).toMatchObject({ nextState: "trial", trialOffer: null, trialEndsAt: null });
    expect(d.reason).toMatch(/subscription unavailable/);
  });
  it("trial → trial refreshes the fields with a fields-only intent (no stage move)", () => {
    const d = decide(snap({ state: "trial" }), ta, ctx({ subscription: sub("30 Day Trial") }));
    expect(d).toMatchObject({ nextState: "trial", trialOffer: "30 Day Trial", trialChanged: true });
    expect(d.intents).toEqual([expect.objectContaining({ kind: "fields", stage: "trial", fields: expect.objectContaining({ trialOffer: "30 Day Trial" }) })]);
  });
  it("any other state: recorded as ignored, nothing changes", () => {
    for (const state of ["active", "payment_failed", "paused"] as BillingState[]) {
      const d = decide(snap({ state }), ta, ctx({ subscription: sub("30 Day Trial") }));
      expect(d).toMatchObject({ nextState: state, noop: true, trialChanged: false });
      expect(d.reason).toBe(`trial_auth ignored (state ${state})`);
    }
  });
});

describe("inactive and churned: never struck, never auto-resumed", () => {
  const all: DunningEvent[] = [wFail, wOk, { kind: "core_failed" }, { kind: "core_succeeded" }, { kind: "trial_auth_succeeded" }, { kind: "invoice_expired" }];
  for (const state of ["inactive", "churned"] as BillingState[]) {
    it(`${state}: every payment event is recorded with "state excludes action"`, () => {
      for (const e of all) {
        const d = decide(snap({ state, strikes: 0, pauseReason: state === "inactive" ? "voluntary" : null }), e, ctx({ walletBalance: neg, subscription: { name: "30 Day Trial", trialEndsAt: null } }));
        expect(d.noop).toBe(true);
        expect(d.nextState).toBe(state);
        expect(d.sideEffects).toEqual([]);
        expect(d.warningCount).toBe(0);
        expect(d.reason).toBe(`state excludes action (${state})`);
      }
    });
  }
});

describe("manual commands", () => {
  const cmd = (stage: BillingState): DunningEvent => ({ kind: "command", stage });
  it("paused → paused (manual_killswitch) with saas_pause in the same decision", () => {
    const d = decide(snap(), cmd("paused"), ctx());
    expect(d).toMatchObject({ nextState: "paused", pauseReason: "manual_killswitch" });
    expect(effects(d)).toEqual(["saas_pause"]);
    expect(stages(d)).toEqual(["paused"]);
  });
  it("inactive → voluntary pause", () => {
    const d = decide(snap(), cmd("inactive"), ctx());
    expect(d).toMatchObject({ nextState: "inactive", pauseReason: "voluntary" });
    expect(effects(d)).toEqual(["saas_pause"]);
  });
  it("active → resume + strikes reset, from every parked or failing state", () => {
    for (const state of ["paused", "inactive", "churned"] as BillingState[]) {
      const d = decide(snap({ state, strikes: 3, pauseReason: "non_payment", coreFailureOpen: true }), cmd("active"), ctx());
      expect(d).toMatchObject({ nextState: "active", warningCount: 0, pauseReason: null, coreFailureOpen: false });
      expect(effects(d)).toEqual(["saas_resume"]);
      expect(stages(d)).toEqual(["active"]);
    }
    const pf = decide(snap({ state: "payment_failed", strikes: 2 }), cmd("active"), ctx());
    expect(pf).toMatchObject({ nextState: "active", warningCount: 0 });
  });
  it("churned → pause location, billing stopped", () => {
    const d = decide(snap(), cmd("churned"), ctx());
    expect(d).toMatchObject({ nextState: "churned", pauseReason: null });
    expect(effects(d)).toEqual(["saas_pause"]);
    expect(d.reason).toMatch(/billing stopped/);
  });
  it("a command whose stage already matches is a CONFIRMATION: no intent; inactive/churned/active re-assert their side effect idempotently, paused does not (its own decision already carried the saas_pause)", () => {
    const paused = decide(snap({ state: "paused", pauseReason: "non_payment", strikes: 3 }), cmd("paused"), ctx());
    expect(paused).toMatchObject({ nextState: "paused", pauseReason: "non_payment", noop: true });
    expect(paused.sideEffects).toEqual([]);
    expect(paused.intents).toEqual([]);
    expect(paused.reason).toMatch(/confirmation/);
    expect(effects(decide(snap({ state: "inactive", pauseReason: "voluntary" }), cmd("inactive"), ctx()))).toEqual(["saas_pause*"]);
    expect(effects(decide(snap({ state: "churned" }), cmd("churned"), ctx()))).toEqual(["saas_pause*"]);
    const active = decide(snap(), cmd("active"), ctx());
    expect(effects(active)).toEqual(["saas_resume*"]);
    expect(active.intents).toEqual([]);
    expect(active.reason).toMatch(/confirmation/);
  });
  it("commands are not blocked by excluded states, and unsupported stages are ignored", () => {
    expect(decide(snap({ state: "churned" }), cmd("active"), ctx()).nextState).toBe("active");
    for (const stage of ["trial", "payment_failed"] as BillingState[]) {
      const d = decide(snap(), cmd(stage), ctx());
      expect(d.noop).toBe(true);
      expect(d.reason).toMatch(/not supported/);
    }
  });
});

describe("pause_confirmed (legacy; the 15-minute debounce was removed)", () => {
  const pc: DunningEvent = { kind: "pause_confirmed" };
  it("decides nothing from any state: no side effect, no intent, no state change", () => {
    for (const state of ["paused", "active", "trial", "payment_failed", "inactive", "churned", null] as (BillingState | null)[]) {
      const d = decide(snap({ state, pauseReason: state === "paused" ? "non_payment" : null }), pc, ctx());
      expect(d.noop).toBe(true);
      expect(d.sideEffects).toEqual([]);
      expect(d.intents).toEqual([]);
      expect(d.nextState).toBe(state);
      expect(d.reason).toMatch(/no confirmation step/);
    }
  });
  it("the full path: the 3rd strike pauses at once; a later cure resumes", () => {
    const strike = decide(snap({ state: "payment_failed", strikes: 2 }), wFail, ctx({ walletBalance: neg }));
    expect(effects(strike)).toEqual(["saas_pause"]);
    const paused = snap({ state: strike.nextState, strikes: strike.warningCount, pauseReason: strike.pauseReason });
    expect(effects(decide(paused, wOk, ctx({ walletBalance: pos })))).toEqual(["saas_resume"]);
  });
});

describe("subscription events (nightly sweep)", () => {
  const cov = new Date("2026-11-21T07:00:00Z");
  const canceled = (duringTrial: boolean): DunningEvent => ({ kind: "subscription_canceled", duringTrial });
  it("canceled / expired → churned with an immediate saas_pause, from every live state (billing stopped)", () => {
    for (const state of ["trial", "active", "payment_failed", "paused", "inactive", null] as (BillingState | null)[]) {
      for (const e of [canceled(false), { kind: "subscription_expired" } as DunningEvent]) {
        const d = decide(snap({ state, strikes: 1, pauseReason: state === "paused" ? "non_payment" : null }), e, ctx());
        expect(d).toMatchObject({ nextState: "churned", pauseReason: null, coreFailureOpen: false });
        expect(effects(d)).toEqual(["saas_pause"]);
        expect(stages(d)).toEqual(["churned"]);
      }
    }
  });
  it("already churned: no change, no second pause", () => {
    const d = decide(snap({ state: "churned" }), canceled(false), ctx());
    expect(d.noop).toBe(true);
    expect(d.reason).toBe("already churned");
  });
  it("covered (now < coreCoveredUntil): churn is DEFERRED and recorded, nothing else", () => {
    for (const e of [canceled(false), { kind: "subscription_expired" } as DunningEvent]) {
      const d = decide(snap(), e, ctx({ coveredUntil: cov }));
      expect(d.noop).toBe(true);
      expect(d.nextState).toBe("active");
      expect(d.sideEffects).toEqual([]);
      expect(d.reason).toMatch(/churn deferred: covered until 2026-11-21/);
    }
  });
  it("…once coverage ends the same event churns", () => {
    expect(decide(snap(), canceled(false), ctx({ now: new Date("2026-11-21T07:00:00Z"), coveredUntil: cov })).nextState).toBe("churned");
  });
  it("a cancel DURING the trial churns immediately, even while covered", () => {
    const d = decide(snap({ state: "trial" }), canceled(true), ctx({ coveredUntil: cov }));
    expect(d).toMatchObject({ nextState: "churned" });
    expect(effects(d)).toEqual(["saas_pause"]);
    expect(d.reason).toMatch(/trial canceled before it ended/);
  });
  it("an expired subscription does not get the trial exemption", () => {
    expect(decide(snap({ state: "trial" }), { kind: "subscription_expired" }, ctx({ coveredUntil: cov })).noop).toBe(true);
  });

  const ended: DunningEvent = { kind: "trial_ended_unconverted" };
  it("trial ended unconverted → payment_failed with the core failure open (no strike, no pause)", () => {
    const d = decide(snap({ state: "trial" }), ended, ctx());
    expect(d).toMatchObject({ nextState: "payment_failed", coreFailureOpen: true, warningCount: 0 });
    expect(d.sideEffects).toEqual([]);
    expect(stages(d)).toEqual(["payment_failed"]);
  });
  it("…but only from trial, and never while covered", () => {
    for (const state of ["active", "payment_failed", "paused", "inactive", "churned", null] as (BillingState | null)[]) expect(decide(snap({ state }), ended, ctx()).noop).toBe(true);
    const d = decide(snap({ state: "trial" }), ended, ctx({ coveredUntil: cov }));
    expect(d.noop).toBe(true);
    expect(d.reason).toMatch(/covered, ignored/);
  });

  const sub = { name: "7 Day Trial", trialEndsAt: new Date("2026-10-05T00:00:00Z") };
  it("newly trialing → trial with offer and end date; a trial refresh is fields-only", () => {
    const d = decide(snap({ state: null }), { kind: "subscription_trialing" }, ctx({ subscription: sub }));
    expect(d).toMatchObject({ nextState: "trial", trialOffer: "7 Day Trial", trialChanged: true });
    expect(stages(d)).toEqual(["trial"]);
    expect(decide(snap({ state: "trial" }), { kind: "subscription_trialing" }, ctx({ subscription: sub })).intents[0]).toMatchObject({ kind: "fields" });
  });
  it("trialing on an account in any other state is ignored (recorded)", () => {
    for (const state of ["active", "payment_failed", "paused"] as BillingState[]) {
      const d = decide(snap({ state }), { kind: "subscription_trialing" }, ctx({ subscription: sub }));
      expect(d).toMatchObject({ nextState: state, noop: true });
      expect(d.reason).toMatch(/trialing ignored/);
    }
    expect(decide(snap({ state: "churned" }), { kind: "subscription_trialing" }, ctx({ subscription: sub })).reason).toBe("state excludes action (churned)");
  });
});

describe("needs*: only read what a rule needs", () => {
  it("balance only for wallet failures on accounts that can be struck", () => {
    expect(needsBalance(snap(), wFail)).toBe(true);
    expect(needsBalance(snap({ state: null }), wFail)).toBe(true);
    for (const state of ["paused", "inactive", "churned"] as BillingState[]) expect(needsBalance(snap({ state }), wFail)).toBe(false);
    expect(needsBalance(snap(), { kind: "core_failed" })).toBe(false);
    // a recharge SUCCESS needs the balance only when it could cure: paused/non_payment, or payment_failed with no core failure open
    expect(needsBalance(snap({ state: "paused", pauseReason: "non_payment" }), wOk)).toBe(true);
    expect(needsBalance(snap({ state: "payment_failed" }), wOk)).toBe(true);
    expect(needsBalance(snap({ state: "payment_failed", coreFailureOpen: true }), wOk)).toBe(false);
    for (const st of [snap(), snap({ state: "trial" }), snap({ state: "inactive" }), snap({ state: "paused", pauseReason: "manual_killswitch" })]) expect(needsBalance(st, wOk)).toBe(false);
  });
  it("subscription only for trial_auth from null/trial", () => {
    expect(needsSubscription(snap({ state: null }), { kind: "trial_auth_succeeded" })).toBe(true);
    expect(needsSubscription(snap({ state: "trial" }), { kind: "trial_auth_succeeded" })).toBe(true);
    expect(needsSubscription(snap({ state: "active" }), { kind: "trial_auth_succeeded" })).toBe(false);
  });
});

describe("purity", () => {
  it("never mutates its inputs and is deterministic", () => {
    const s = Object.freeze(snap({ state: "payment_failed", strikes: 2 }));
    const c = Object.freeze(ctx({ walletBalance: neg }));
    const a = decide(s, wFail, c);
    const b = decide(s, wFail, c);
    expect(a).toEqual(b);
    expect(s).toEqual(snap({ state: "payment_failed", strikes: 2 }));
  });
});
