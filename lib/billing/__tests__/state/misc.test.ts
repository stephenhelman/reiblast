import { describe, expect, it, vi } from "vitest";
import type { BillingClass } from "@prisma/client";
import { estimateBalanceAt, freshSnapshotBefore, nearestAnchor, netChangeBetween, resolveReplayBalance, SNAPSHOT_FRESH_MS } from "../../state/balance";
import { ensureGhlAccount, setGhlAccountLocation } from "../../state/dualWrite";
import { eventFromLedger } from "../../state/events";
import { milestones, replayAccount, seedSnapshot, type ReplayEvent } from "../../state/replay";
import { parseSubscription, zonedToUtc } from "../../state/subscription";
import type { BalanceReading } from "../../state/types";
import { summarizeProjectionDiff } from "../../reports/health";

const D = (s: string) => new Date(s);

describe("ledger → engine event", () => {
  const row = (classification: BillingClass, status: string, over: Record<string, unknown> = {}) => ({ ghlTransactionId: "tx1", classification, status, ghlAccountId: "A1", occurredAt: D("2026-09-01T00:00:00Z"), subscriptionId: null, ...over }) as Parameters<typeof eventFromLedger>[0];
  it("maps wallet and core rows by status", () => {
    expect(eventFromLedger(row("wallet_auto_recharge", "failed"))).toMatchObject({ ok: true, value: { trigger: "ledger:tx1", event: { kind: "wallet_recharge_failed", wallet: "auto" } } });
    expect(eventFromLedger(row("wallet_manual_recharge", "succeeded"))).toMatchObject({ ok: true, value: { event: { kind: "wallet_recharge_succeeded", wallet: "manual" } } });
    expect(eventFromLedger(row("core_subscription", "failed"))).toMatchObject({ value: { event: { kind: "core_failed" } } });
    expect(eventFromLedger(row("core_subscription", "succeeded"))).toMatchObject({ value: { event: { kind: "core_succeeded" } } });
    expect(eventFromLedger(row("trial_auth", "succeeded", { subscriptionId: "sub1" }))).toMatchObject({ value: { event: { kind: "trial_auth_succeeded" }, subscriptionId: "sub1" } });
  });
  it("skips non-terminal, unmatched and rule-less rows", () => {
    expect(eventFromLedger(row("wallet_auto_recharge", "pending"))).toEqual({ ok: false, skip: "status pending is not terminal" });
    expect(eventFromLedger(row("wallet_auto_recharge", "refunded")).ok).toBe(false);
    expect(eventFromLedger(row("core_subscription", "succeeded", { ghlAccountId: null }))).toEqual({ ok: false, skip: "unmatched (no account)" });
    for (const c of ["failed_signup", "unclassified", "refund"] as BillingClass[]) expect(eventFromLedger(row(c, "failed")).ok).toBe(false);
    expect(eventFromLedger(row("trial_auth", "failed")).ok).toBe(false);
  });
});

describe("subscription parsing", () => {
  it("single-record shape: name from entitySource, trial end from the schedule in the subscription's timezone (DST-aware)", () => {
    const s = parseSubscription({ status: "trialing", entitySource: { name: "30 Day Trial" }, schedule: { rrule: { startDate: "2026-10-25", startTime: "17:05:48", timezone: "US/Mountain" } } });
    expect(s?.name).toBe("30 Day Trial");
    expect(s?.trialEndsAt?.toISOString()).toBe("2026-10-25T23:05:48.000Z"); // MDT (UTC−6)
    expect(parseSubscription({ status: "trialing", entitySource: { name: "7 Day Trial" }, schedule: { rrule: { startDate: "2026-12-05", startTime: "10:00:00", timezone: "America/Denver" } } })?.trialEndsAt?.toISOString()).toBe("2026-12-05T17:00:00.000Z"); // MST (UTC−7)
  });
  it("list shape: entitySourceName + trialEndDate", () => {
    expect(parseSubscription({ status: "trialing", entitySourceName: "7 Day Trial", trialEndDate: "2026-09-30T06:18:54.849Z" })).toEqual({ name: "7 Day Trial", trialEndsAt: D("2026-09-30T06:18:54.849Z") });
  });
  it("a non-trial subscription gets no derived end date; garbage returns null", () => {
    expect(parseSubscription({ status: "active", entitySource: { name: "Core" }, schedule: { rrule: { startDate: "2026-10-25", startTime: "17:00:00", timezone: "US/Mountain" } } })?.trialEndsAt).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("nope")).toBeNull();
    expect(zonedToUtc("2026-13-40", "10:00", "US/Mountain")).not.toBeUndefined();
    expect(zonedToUtc("x", "10:00", "US/Mountain")).toBeNull();
    expect(zonedToUtc("2026-10-25", "10:00", "Not/AZone")).toBeNull();
  });
});

describe("estimated balances (replay)", () => {
  const anchor = { at: D("2026-09-26T18:00:00Z"), balance: "10.000000" };
  it("before the anchor: balance = anchor − net change (credits + usage) between the event and the anchor", () => {
    // between event and anchor: +$20 recharge credit and −$8 usage → the balance ROSE by 12 → it was 12 lower before
    expect(estimateBalanceAt(anchor, D("2026-09-20T00:00:00Z"), "12.000000")).toBe("-2.000000");
    expect(estimateBalanceAt(anchor, D("2026-09-20T00:00:00Z"), "-5.000000")).toBe("15.000000");
  });
  it("after the anchor: balance = anchor + net change since", () => {
    expect(estimateBalanceAt(anchor, D("2026-09-27T00:00:00Z"), "-4.000000")).toBe("6.000000");
  });
  it("netChangeBetween counts credits strictly after the earlier bound up to the later one, in either direction", () => {
    const credits = [{ at: D("2026-09-21T00:00:00Z"), amount: "20.000000" }, { at: D("2026-09-20T00:00:00Z"), amount: "99.000000" }, { at: D("2026-09-27T00:00:00Z"), amount: "50.000000" }];
    expect(netChangeBetween(D("2026-09-20T00:00:00Z"), anchor.at, credits, "-8.000000")).toBe("12.000000"); // excludes the credit AT the lower bound and the later one
    expect(netChangeBetween(anchor.at, D("2026-09-20T00:00:00Z"), credits, "-8.000000")).toBe("12.000000");
  });
  it("nearest usable anchor, ignoring unavailable snapshots", () => {
    const snaps = [{ at: D("2026-09-01T00:00:00Z"), status: "unavailable", balance: null }, { at: D("2026-09-26T18:00:00Z"), status: "ok", balance: "10.000000" }];
    expect(nearestAnchor(snaps, D("2026-08-07T00:00:00Z"))).toEqual({ at: D("2026-09-26T18:00:00Z"), balance: "10.000000" });
    expect(nearestAnchor([{ at: D("2026-09-01T00:00:00Z"), status: "error", balance: null }], D("2026-09-02T00:00:00Z"))).toBeNull();
  });
  it("a real snapshot shortly before the event beats an estimate; an old one does not", () => {
    const t = D("2026-09-26T20:00:00Z");
    const snaps = [{ at: D("2026-09-26T18:00:00Z"), status: "ok", balance: "10.000000" }];
    expect(freshSnapshotBefore(snaps, t)).toBe("10.000000");
    expect(freshSnapshotBefore(snaps, new Date(D("2026-09-26T18:00:00Z").getTime() + SNAPSHOT_FRESH_MS + 1))).toBeNull();
    expect(freshSnapshotBefore(snaps, D("2026-09-26T17:00:00Z"))).toBeNull(); // snapshot is AFTER the event
  });
  it("resolveReplayBalance: fresh → real; anchor → ESTIMATED; none → unknown", () => {
    const snaps = [{ at: D("2026-09-26T18:00:00Z"), status: "ok", balance: "10.000000" }];
    expect(resolveReplayBalance({ snapshots: snaps, t: D("2026-09-26T20:00:00Z"), credits: [], usageBetween: () => "0.000000" })).toEqual({ status: "ok", value: "10.000000", estimated: false });
    const e = resolveReplayBalance({ snapshots: snaps, t: D("2026-08-07T00:00:00Z"), credits: [{ at: D("2026-09-01T00:00:00Z"), amount: "30.000000" }], usageBetween: () => "-25.000000" });
    expect(e).toEqual({ status: "ok", value: "5.000000", estimated: true }); // 10 − (30 − 25)
    expect(resolveReplayBalance({ snapshots: [], t: D("2026-08-07T00:00:00Z"), credits: [], usageBetween: () => "0" })).toMatchObject({ status: "unknown", why: expect.stringMatching(/no balance snapshot/) });
    expect(resolveReplayBalance({ snapshots: snaps, t: D("2026-08-07T00:00:00Z"), credits: [], usageBetween: () => null })).toMatchObject({ status: "unknown" });
  });
});

describe("replay core", () => {
  const ev = (kind: string, at: string, id: string, extra: Record<string, unknown> = {}): ReplayEvent => ({ trigger: `ledger:${id}`, eventAt: D(at), subscriptionId: null, event: { kind, wallet: "auto", ...extra } as never });
  const neg: BalanceReading = { status: "ok", value: "-2.000000", estimated: true };
  const pos: BalanceReading = { status: "ok", value: "6.000000", estimated: true };
  // failures happen while the balance is negative; the recharge that follows clears it
  const balanceByKind = (e: ReplayEvent) => (e.event.kind === "wallet_recharge_succeeded" ? pos : neg);
  const run = (events: ReplayEvent[], over: Partial<Parameters<typeof replayAccount>[1]> = {}) => replayAccount(events, { seed: { state: "active", strikes: 0, pauseReason: null, coreFailureOpen: false }, coveredUntil: null, balanceFor: balanceByKind, subscriptionFor: () => null, ...over });

  it("seed: trial when the first core-related row is trial_auth, else active", () => {
    const r = (c: BillingClass, at: string) => ({ classification: c, occurredAt: D(at) });
    expect(seedSnapshot([r("trial_auth", "2026-07-01T00:00:00Z"), r("core_subscription", "2026-07-08T00:00:00Z")]).state).toBe("trial");
    expect(seedSnapshot([r("core_subscription", "2026-06-01T00:00:00Z"), r("trial_auth", "2026-07-01T00:00:00Z")]).state).toBe("active");
    expect(seedSnapshot([r("wallet_auto_recharge", "2026-07-01T00:00:00Z")]).state).toBe("active"); // no core-related row
    expect(seedSnapshot([]).state).toBe("active");
    expect(seedSnapshot([r("trial_auth", "2026-07-01T00:00:00Z")])).toEqual({ state: "trial", strikes: 0, pauseReason: null, coreFailureOpen: false });
  });

  it("a full lifecycle: 3 strikes → paused → wallet recharge resumes → later core failure → core success", () => {
    const out = run([
      ev("wallet_recharge_failed", "2026-08-01T00:00:00Z", "a"),
      ev("wallet_recharge_failed", "2026-08-02T00:00:00Z", "b"),
      ev("wallet_recharge_failed", "2026-08-03T00:00:00Z", "c"),
      ev("wallet_recharge_succeeded", "2026-08-04T00:00:00Z", "d"),
      ev("core_failed", "2026-08-10T00:00:00Z", "e"),
      ev("core_succeeded", "2026-08-12T00:00:00Z", "f"),
    ]);
    expect(out.steps.map((s) => [s.decision.nextState, s.decision.warningCount])).toEqual([["payment_failed", 1], ["payment_failed", 2], ["paused", 3], ["active", 0], ["payment_failed", 0], ["active", 0]]);
    expect(out.final).toMatchObject({ state: "active", strikes: 0, pauseReason: null, coreFailureOpen: false });
    expect(milestones(out.steps).map((m) => m.kind)).toEqual(["strike", "payment_failed", "strike", "strike", "paused", "resumed", "payment_failed", "recovered"]);
  });

  it("the resume guard in replay: a recharge that leaves the estimated balance negative does not resume", () => {
    const events = [ev("wallet_recharge_failed", "2026-08-01T00:00:00Z", "a"), ev("wallet_recharge_failed", "2026-08-02T00:00:00Z", "b"), ev("wallet_recharge_failed", "2026-08-03T00:00:00Z", "c"), ev("wallet_recharge_succeeded", "2026-08-04T00:00:00Z", "d"), ev("wallet_recharge_succeeded", "2026-08-05T00:00:00Z", "e")];
    const out = run(events, { balanceFor: (e) => (e.trigger === "ledger:d" ? neg : balanceByKind(e)) });
    expect(out.steps.map((s) => [s.decision.nextState, s.decision.warningCount])).toEqual([["payment_failed", 1], ["payment_failed", 2], ["paused", 3], ["paused", 0], ["active", 0]]);
    expect(out.steps[3].decision.reason).toMatch(/balance still negative/);
    expect(out.steps[4].decision.sideEffects).toEqual([{ type: "saas_resume" }]);
  });

  it("processes events in time order regardless of input order", () => {
    const out = run([ev("wallet_recharge_succeeded", "2026-08-04T00:00:00Z", "d"), ev("wallet_recharge_failed", "2026-08-01T00:00:00Z", "a")]);
    expect(out.steps.map((s) => s.trigger)).toEqual(["ledger:a", "ledger:d"]);
  });

  it("coverage is checked at each event's own time", () => {
    const cov = D("2026-08-15T00:00:00Z");
    const out = run([ev("core_failed", "2026-08-10T00:00:00Z", "in"), ev("core_failed", "2026-08-20T00:00:00Z", "out")], { coveredUntil: cov });
    expect(out.steps[0].decision.reason).toMatch(/covered, ignored/);
    expect(out.steps[0].decision.nextState).toBe("active");
    expect(out.steps[1].decision.nextState).toBe("payment_failed");
    expect(milestones(out.steps).some((m) => m.kind === "covered_ignored")).toBe(true);
  });

  it("unknown balances never count strikes; balance is only requested when needed", () => {
    const asked: string[] = [];
    const out = run([ev("wallet_recharge_failed", "2026-08-01T00:00:00Z", "a"), ev("wallet_recharge_succeeded", "2026-08-02T00:00:00Z", "b")], { balanceFor: (e) => (asked.push(e.trigger), { status: "unknown", why: "no balance snapshot to reconstruct from" }) });
    expect(out.final.strikes).toBe(0);
    expect(out.steps[0].decision.reason).toMatch(/balance unknown.*strike not counted/);
    expect(asked).toEqual(["ledger:a"]);
  });

  it("trial_auth from a trial seed records the trial offer; events on inactive/churned accounts change nothing", () => {
    const t = run([{ ...ev("trial_auth_succeeded", "2026-08-01T00:00:00Z", "t"), subscriptionId: "s1" }], { seed: { state: "trial", strikes: 0, pauseReason: null, coreFailureOpen: false }, subscriptionFor: () => ({ name: "30 Day Trial", trialEndsAt: D("2026-08-31T00:00:00Z") }) });
    expect(t.final).toMatchObject({ state: "trial", trialOffer: "30 Day Trial" });
    const churned = run([ev("wallet_recharge_failed", "2026-08-01T00:00:00Z", "a"), ev("core_succeeded", "2026-08-02T00:00:00Z", "b")], { seed: { state: "churned", strikes: 0, pauseReason: null, coreFailureOpen: false } });
    expect(churned.final.state).toBe("churned");
    expect(churned.steps.every((s) => s.decision.noop)).toBe(true);
  });
});

describe("GhlAccount dual-write (live-route additive hook)", () => {
  const fakePrisma = (existing: Record<string, unknown> | null, opts: { throwOn?: string; hang?: boolean } = {}) => {
    const calls: { fn: string; args: any }[] = [];
    const db: any = {
      ghlAccount: {
        findUnique: async (a: any) => { calls.push({ fn: "findUnique", args: a }); if (opts.throwOn === "findUnique") throw new Error("table missing"); if (opts.hang) return new Promise(() => {}); return existing; },
        create: async (a: any) => { calls.push({ fn: "create", args: a }); if (opts.throwOn === "create") throw new Error("unique violation"); return {}; },
        update: async (a: any) => { calls.push({ fn: "update", args: a }); return {}; },
      },
    };
    return { db, calls };
  };
  it("creates a member account keyed by userId when none exists", async () => {
    const { db, calls } = fakePrisma(null);
    await ensureGhlAccount(db, { userId: "U1", contactId: "C1" });
    expect(calls.map((c) => c.fn)).toEqual(["findUnique", "create"]);
    expect(calls[0].args.where).toEqual({ userId: "U1" });
    expect(calls[1].args.data).toEqual({ userId: "U1", contactId: "C1", accountType: "member" });
  });
  it("refreshes a changed contactId; leaves an unchanged one; never touches an internal account", async () => {
    let r = fakePrisma({ id: "G1", accountType: "member", contactId: "OLD" });
    await ensureGhlAccount(r.db, { userId: "U1", contactId: "NEW" });
    expect(r.calls.map((c) => c.fn)).toEqual(["findUnique", "update"]);
    expect(r.calls[1].args).toEqual({ where: { id: "G1" }, data: { contactId: "NEW" } });
    r = fakePrisma({ id: "G1", accountType: "member", contactId: "SAME" });
    await ensureGhlAccount(r.db, { userId: "U1", contactId: "SAME" });
    expect(r.calls.map((c) => c.fn)).toEqual(["findUnique"]);
    r = fakePrisma({ id: "G1", accountType: "internal", contactId: "OLD" });
    await ensureGhlAccount(r.db, { userId: "U1", contactId: "NEW" });
    expect(r.calls.map((c) => c.fn)).toEqual(["findUnique"]);
  });
  it("does nothing without a contact id", async () => {
    const r = fakePrisma(null);
    await ensureGhlAccount(r.db, { userId: "U1", contactId: "" });
    expect(r.calls).toEqual([]);
  });
  it("sets the location; creates the member account only when it can (real contact id)", async () => {
    let r = fakePrisma({ id: "G1", accountType: "member", locationId: null });
    await setGhlAccountLocation(r.db, { userId: "U1", locationId: "LOC1", contactId: "C1" });
    expect(r.calls[1]).toMatchObject({ fn: "update", args: { where: { id: "G1" }, data: { locationId: "LOC1" } } });
    r = fakePrisma(null);
    await setGhlAccountLocation(r.db, { userId: "U1", locationId: "LOC1", contactId: "C1" });
    expect(r.calls[1]).toMatchObject({ fn: "create", args: { data: { userId: "U1", contactId: "C1", locationId: "LOC1", accountType: "member" } } });
    r = fakePrisma(null);
    await setGhlAccountLocation(r.db, { userId: "U1", locationId: "LOC1", contactId: "test_123" });
    expect(r.calls.map((c) => c.fn)).toEqual(["findUnique"]); // test contact: nothing safe to create
    r = fakePrisma({ id: "G1", accountType: "internal", locationId: null });
    await setGhlAccountLocation(r.db, { userId: "U1", locationId: "LOC1" });
    expect(r.calls.map((c) => c.fn)).toEqual(["findUnique"]);
  });
  it("NEVER throws: any failure is swallowed and logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ensureGhlAccount(fakePrisma(null, { throwOn: "findUnique" }).db, { userId: "U1", contactId: "C1" })).resolves.toBeUndefined();
    await expect(ensureGhlAccount(fakePrisma(null, { throwOn: "create" }).db, { userId: "U1", contactId: "C1" })).resolves.toBeUndefined();
    await expect(setGhlAccountLocation(fakePrisma(null, { throwOn: "findUnique" }).db, { userId: "U1", locationId: "L", contactId: "C" })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it("is bounded in time: a hung database cannot hold the live route (3 s cap)", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const p = ensureGhlAccount(fakePrisma(null, { hang: true }).db, { userId: "U1", contactId: "C1" });
      await vi.advanceTimersByTimeAsync(3100);
      await expect(p).resolves.toBeUndefined();
      expect(err).toHaveBeenCalledWith(expect.stringContaining("ensureGhlAccount failed"), expect.stringContaining("timed out"));
    } finally {
      err.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("health: shadow-vs-actual projection summary", () => {
  it("counts accounts where the projected state differs, separating not-yet-seeded ones", () => {
    const s = summarizeProjectionDiff([
      { projected: "active", actual: "active", n: 10 },
      { projected: "paused", actual: "active", n: 2 },
      { projected: "active", actual: null, n: 4 },
      { projected: "payment_failed", actual: "trial", n: 1 },
    ]);
    expect(s).toMatchObject({ projectedCount: 17, differs: 7, differsSeeded: 3, differsUnseeded: 4 });
    expect(s.breakdown[0]).toEqual({ projected: "active", actual: "not seeded", n: 4 });
    expect(summarizeProjectionDiff([])).toMatchObject({ projectedCount: 0, differs: 0, breakdown: [] });
  });
});
