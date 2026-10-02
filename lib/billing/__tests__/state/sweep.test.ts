import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubRow } from "../../subscriptions";
import type { InvoiceInfo } from "../../invoices";

const feed = vi.hoisted(() => ({ subs: [] as any[], invoices: [] as any[], subCalls: 0, invCalls: 0 }));
// the mock returns what the real listSubscriptionsPage returns: PARSED rows (the fixtures are the raw GHL list shape)
vi.mock("../../subscriptions", async (orig) => {
  const actual = await orig<typeof import("../../subscriptions")>();
  return { ...actual, listSubscriptionsPage: vi.fn(async (offset: number, limit = 100) => (feed.subCalls++, feed.subs.slice(offset, offset + limit).map(actual.parseSubRow).filter(Boolean))) };
});
vi.mock("../../invoices", async (orig) => ({ ...(await orig<typeof import("../../invoices")>()), listInvoicesPage: vi.fn(async (offset: number, limit = 100) => (feed.invCalls++, feed.invoices.slice(offset, offset + limit))) }));

import { runSubSweep } from "../../jobs/subSweep";
import { churnTrigger, hasOtherLiveSubscription, transitionEvents, trialEndedTrigger, trialEndedWithoutRelationshipEnd } from "../../state/sweepRules";
import { parseSubRow } from "../../subscriptions";
import { makeFake, member } from "./_fake";

const D = (s: string) => new Date(s);
const NOW = D("2026-09-28T12:00:00Z");

const sub = (o: Partial<SubRow> & { subscriptionId: string; contactId: string; status: string }): SubRow => ({ name: "REIblast Core", trialEndsAt: null, cancelledAt: null, updatedAt: null, ...o });

describe("transition rules (pure)", () => {
  it("no event without a status change", () => {
    expect(transitionEvents(sub({ subscriptionId: "s", contactId: "c", status: "canceled" }), "canceled", NOW)).toEqual([]);
  });
  it("canceled: DURING the trial when cancelledAt < trial end (falls back to updatedAt); otherwise a normal cancel", () => {
    const base = { subscriptionId: "s", contactId: "c", status: "canceled", trialEndsAt: D("2026-09-22T00:00:00Z") };
    expect(transitionEvents(sub({ ...base, cancelledAt: D("2026-09-16T00:00:00Z") }), "trialing", NOW)[0].event).toEqual({ kind: "subscription_canceled", duringTrial: true });
    expect(transitionEvents(sub({ ...base, cancelledAt: D("2026-09-23T00:00:00Z") }), "active", NOW)[0].event).toEqual({ kind: "subscription_canceled", duringTrial: false });
    expect(transitionEvents(sub({ ...base, updatedAt: D("2026-09-16T00:00:00Z") }), "trialing", NOW)[0].event).toEqual({ kind: "subscription_canceled", duringTrial: true });
    expect(transitionEvents(sub({ subscriptionId: "s", contactId: "c", status: "canceled" }), "active", NOW)[0].event).toEqual({ kind: "subscription_canceled", duringTrial: false }); // no trial info
  });
  it("expired and newly-trialing; paused / unpaid / active / incomplete_expired NEVER emit", () => {
    expect(transitionEvents(sub({ subscriptionId: "s", contactId: "c", status: "expired" }), "active", NOW)[0]).toMatchObject({ suffix: "expired", event: { kind: "subscription_expired" } });
    expect(transitionEvents(sub({ subscriptionId: "s", contactId: "c", status: "trialing" }), null, NOW)[0]).toMatchObject({ suffix: "trialing", event: { kind: "subscription_trialing" } });
    for (const status of ["paused", "unpaid", "active", "incomplete_expired"]) expect(transitionEvents(sub({ subscriptionId: "s", contactId: "c", status }), "trialing", NOW)).toEqual([]);
  });
  it("first-run seed treats the current status as new (prev null)", () => {
    expect(transitionEvents(sub({ subscriptionId: "s", contactId: "c", status: "canceled" }), null, NOW)).toHaveLength(1);
  });
  it("churn trigger: deferred (with the coverage date) while covered, plain once coverage ended; never deferred during a trial", () => {
    const cov = D("2026-11-21T07:00:00Z");
    expect(churnTrigger("s1", "canceled", { duringTrial: false, coveredUntil: cov, now: NOW })).toBe("sub:s1:canceled:deferred:2026-11-21");
    expect(churnTrigger("s1", "canceled", { duringTrial: false, coveredUntil: cov, now: D("2026-11-21T07:00:00Z") })).toBe("sub:s1:canceled");
    expect(churnTrigger("s1", "expired", { duringTrial: false, coveredUntil: null, now: NOW })).toBe("sub:s1:expired");
    expect(churnTrigger("s1", "canceled", { duringTrial: true, coveredUntil: cov, now: NOW })).toBe("sub:s1:canceled");
  });
  it("another live subscription (trialing/active/unpaid — not paused) blocks a churn", () => {
    const all = [{ id: "a", contactId: "c1", status: "canceled" }, { id: "b", contactId: "c1", status: "active" }, { id: "c", contactId: "c2", status: "canceled" }, { id: "d", contactId: "c2", status: "paused" }, { id: "e", contactId: "c3", status: "canceled" }, { id: "f", contactId: "c3", status: "unpaid" }, { id: "g", contactId: "c4", status: "canceled" }, { id: "h", contactId: "c4", status: "canceled" }];
    expect(hasOtherLiveSubscription(all, all[0])).toBe(true);
    expect(hasOtherLiveSubscription(all, all[2])).toBe(false); // paused is billing stopped
    expect(hasOtherLiveSubscription(all, all[4])).toBe(true);
    expect(hasOtherLiveSubscription(all, all[6])).toBe(false);
    expect(hasOtherLiveSubscription(all, all[1])).toBe(false); // itself doesn't count
  });
  it("a trial ended +2 days on a live subscription; never on canceled/expired, or before the grace", () => {
    const end = D("2026-09-20T00:00:00Z");
    expect(trialEndedWithoutRelationshipEnd({ status: "trialing", trialEndsAt: end }, D("2026-09-22T00:00:01Z"))).toBe(true);
    expect(trialEndedWithoutRelationshipEnd({ status: "trialing", trialEndsAt: end }, D("2026-09-22T00:00:00Z"))).toBe(false);
    expect(trialEndedWithoutRelationshipEnd({ status: "canceled", trialEndsAt: end }, NOW)).toBe(false);
    expect(trialEndedWithoutRelationshipEnd({ status: "active", trialEndsAt: null }, NOW)).toBe(false);
    expect(trialEndedTrigger("s9")).toBe("sub:s9:trial_ended");
  });
  it("parses the list shape keyed by subscriptionId (falls back to _id)", () => {
    expect(parseSubRow({ _id: "mongo1", subscriptionId: "sub1", contactId: "c1", status: "canceled", entitySourceName: "7 Day Trial", trialEndDate: "2026-09-22T00:00:00Z", cancelledAt: "2026-09-16T00:00:00Z" })).toMatchObject({ subscriptionId: "sub1", contactId: "c1", status: "canceled", name: "7 Day Trial" });
    expect(parseSubRow({ _id: "mongo1", contactId: "c1", status: "active" })?.subscriptionId).toBe("mongo1");
    expect(parseSubRow({ contactId: "c1" })).toBeNull();
  });
});

// ── the job ─────────────────────────────────────────────────────────────────

const ctxFor = (db: any, o: { apply?: boolean; now?: Date; cursor?: any; shouldYield?: () => boolean } = {}) => ({ db, apply: o.apply ?? true, cursor: o.cursor ?? null, now: o.now ?? NOW, shouldYield: o.shouldYield ?? (() => false) });
const run = (db: any, o: Parameters<typeof ctxFor>[1] = {}) => runSubSweep(ctxFor(db, o));
const S = (o: Record<string, unknown>) => ({ subscriptionId: o.subscriptionId, contactId: o.contactId, status: o.status, entitySourceName: o.name ?? "REIblast Core", trialEndDate: o.trialEnd ?? null, cancelledAt: o.cancelledAt ?? null, updatedAt: o.updatedAt ?? null });
const parsed = (rows: Record<string, unknown>[]) => rows.map((r) => parseSubRow(S(r))!);

const accounts = () => [
  member({ id: "A1", contactId: "CONTACT1", billingState: "trial", locationId: "LOC1" }),
  member({ id: "A2", contactId: "CONTACT2", billingState: "active", locationId: "LOC2", coreCoveredUntil: D("2026-10-15T00:00:00Z") }),
  member({ id: "A3", contactId: "CONTACT3", billingState: "trial", locationId: "LOC3" }),
  member({ id: "A4", contactId: "CONTACT4", billingState: "trial", locationId: "LOC4" }),
  member({ id: "A5", contactId: "CONTACT5", billingState: "active", locationId: "LOC5" }),
  member({ id: "A6", contactId: "CONTACT6", billingState: "active", locationId: "LOC6" }),
  member({ id: "A7", contactId: "CONTACT7", billingState: "active", locationId: "LOC7" }),
];
const ledger = () => [
  { ghlTransactionId: "t3", ghlAccountId: "A3", classification: "trial_auth", status: "succeeded", occurredAt: D("2026-09-13T00:00:00Z"), subscriptionId: "S3" },
  { ghlTransactionId: "t4", ghlAccountId: "A4", classification: "trial_auth", status: "succeeded", occurredAt: D("2026-09-13T00:00:00Z"), subscriptionId: "S4" },
  { ghlTransactionId: "c4", ghlAccountId: "A4", classification: "core_subscription", status: "succeeded", occurredAt: D("2026-09-21T00:00:00Z"), subscriptionId: "S4" }, // converted
];
const baseSubs = () => [
  { subscriptionId: "S1", contactId: "CONTACT1", status: "trialing", name: "30 Day Trial", trialEnd: "2026-10-20T00:00:00Z" },
  { subscriptionId: "S2", contactId: "CONTACT2", status: "active" },
  { subscriptionId: "S3", contactId: "CONTACT3", status: "trialing", name: "7 Day Trial", trialEnd: "2026-09-20T00:00:00Z" },
  { subscriptionId: "S4", contactId: "CONTACT4", status: "trialing", name: "7 Day Trial", trialEnd: "2026-09-20T00:00:00Z" },
  { subscriptionId: "S5a", contactId: "CONTACT5", status: "active" },
  { subscriptionId: "S6", contactId: "CONTACT6", status: "unpaid" },
];
const setSubs = (rows: Record<string, unknown>[]) => (feed.subs = rows.map(S));

beforeEach(() => {
  feed.subs = []; feed.invoices = []; feed.subCalls = 0; feed.invCalls = 0;
  delete process.env.DUNNING_MODE;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sub_sweep job", () => {
  it("FIRST RUN (--apply): seeds GhlSubscriptionState and emits NOTHING — but reports what it would emit", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs([...baseSubs(), { subscriptionId: "S7", contactId: "CONTACT7", status: "canceled", updatedAt: "2026-09-01T00:00:00Z" }]);
    const r = await run(db);
    expect(r.done).toBe(true);
    const s = r.summary as any;
    expect(s).toMatchObject({ seed: true, emitting: false, dryRun: false, subscriptions: 7 });
    expect(db.subStates).toHaveLength(7);
    expect(db.subStates.find((x: any) => x.subscriptionId === "S1")).toMatchObject({ contactId: "CONTACT1", status: "trialing", name: "30 Day Trial" });
    expect(db.decisions).toHaveLength(0);
    expect(db.intents).toHaveLength(0);
    expect(s["wouldEmit:subscription_trialing"]).toBe(3);
    expect(s["wouldEmit:subscription_canceled"]).toBe(1);
    expect(s["wouldEmit:trial_ended_unconverted"]).toBe(1); // S3 only: S4 converted
    expect(s.trialConverted).toBe(1);
    expect(s["status:unpaid"]).toBe(1);
  });

  it("dry-run writes NOTHING at all (no state rows, no decisions), seed or not", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db, { apply: false });
    expect(db.subStates).toHaveLength(0);
    expect(db.decisions).toHaveLength(0);
    await run(db); // seed
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S1" ? { ...x, status: "canceled", cancelledAt: "2026-09-27T00:00:00Z" } : x)));
    const before = db.subStates.map((x: any) => ({ ...x }));
    const r = await run(db, { apply: false });
    expect((r.summary as any)).toMatchObject({ seed: false, emitting: false, dryRun: true });
    expect(db.decisions).toHaveLength(0);
    expect(db.subStates).toEqual(before);
  });

  it("later run: a cancel DURING the trial churns immediately (shadow decision + skipped_shadow intent; no account write)", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db); // seed
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S1" ? { ...x, status: "canceled", cancelledAt: "2026-09-27T00:00:00Z" } : x)));
    const r = await run(db);
    expect((r.summary as any)).toMatchObject({ seed: false, emitting: true, statusChanged: 1 });
    const d = db.decisions.find((x: any) => x.trigger === "sub:S1:canceled");
    expect(d).toMatchObject({ mode: "shadow", ghlAccountId: "A1", toState: "churned", eventKind: "subscription_canceled" });
    expect(d.sideEffects).toEqual([expect.objectContaining({ type: "saas_pause" })]); // recorded; nothing executes in shadow
    expect(db.intents.filter((i: any) => i.ghlAccountId === "A1").map((i: any) => [i.payload.stage, i.status])).toEqual([["churned", "skipped_shadow"]]);
    expect(db.intents.every((i: any) => i.status === "skipped_shadow")).toBe(true); // (the trial-expiry intent for A3 is recorded too — also shadow)
    expect(db.subStates.find((x: any) => x.subscriptionId === "S1").status).toBe("canceled");
  });

  it("COVERAGE-DELAYED CHURN: while covered the churn is recorded as deferred; once coverage ends the next run churns — exactly once", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db); // seed (S2 active, A2 covered until 2026-10-15)
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S2" ? { ...x, status: "canceled", updatedAt: "2026-09-27T00:00:00Z" } : x)));
    await run(db);
    const deferred = db.decisions.filter((d: any) => d.ghlAccountId === "A2");
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({ trigger: "sub:S2:canceled:deferred:2026-10-15", toState: "active", sideEffects: [] });
    expect(deferred[0].reason).toMatch(/churn deferred: covered until 2026-10-15/);

    await run(db, { now: D("2026-10-10T00:00:00Z") }); // still covered: nothing new
    expect(db.decisions.filter((d: any) => d.ghlAccountId === "A2")).toHaveLength(1);

    const after = D("2026-10-16T00:00:00Z"); // coverage over
    await run(db, { now: after });
    const a2 = db.decisions.filter((d: any) => d.ghlAccountId === "A2");
    expect(a2).toHaveLength(2);
    expect(a2[1]).toMatchObject({ trigger: "sub:S2:canceled", toState: "churned" });
    await run(db, { now: D("2026-10-17T00:00:00Z") }); // and never again
    expect(db.decisions.filter((d: any) => d.ghlAccountId === "A2")).toHaveLength(2);
  });

  it("a cancel while the contact still holds another LIVE subscription does not churn", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db);
    setSubs([...baseSubs(), { subscriptionId: "S5b", contactId: "CONTACT5", status: "canceled", updatedAt: "2026-09-27T00:00:00Z" }]);
    const r = await run(db);
    expect((r.summary as any).churnSkippedOtherLiveSubscription).toBe(1);
    expect(db.decisions.some((d: any) => d.ghlAccountId === "A5")).toBe(false);
  });

  it("expired → churned; unpaid / paused / incomplete_expired and plain active never emit", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db);
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S6" ? { ...x, status: "paused" } : x.subscriptionId === "S5a" ? { ...x, status: "expired" } : x)));
    await run(db);
    expect(db.decisions.filter((d: any) => d.ghlAccountId === "A6")).toHaveLength(0); // unpaid → paused: no event
    const e = db.decisions.find((d: any) => d.ghlAccountId === "A5");
    expect(e).toMatchObject({ trigger: "sub:S5a:expired", toState: "churned" });
  });

  it("TRIAL EXPIRY: > trial end + 2 days with no paid core since the trial began → payment_failed (core failure open); a converted trial is left alone; runs once", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db); // seed
    const r = await run(db);
    expect((r.summary as any)).toMatchObject({ trialUnconverted: 1, trialConverted: 1 });
    const d = db.decisions.filter((x: any) => x.eventKind === "trial_ended_unconverted");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ trigger: "sub:S3:trial_ended", ghlAccountId: "A3", fromState: "trial", toState: "payment_failed", coreFailureOpen: true, toStrikes: 0 });
    await run(db);
    expect(db.decisions.filter((x: any) => x.eventKind === "trial_ended_unconverted")).toHaveLength(1); // idempotent
  });
  it("trial expiry is protected by coverage", async () => {
    const acc = accounts();
    acc[2].coreCoveredUntil = D("2026-12-01T00:00:00Z");
    const db = makeFake(acc, ledger());
    setSubs(baseSubs());
    await run(db);
    await run(db);
    expect(db.decisions.find((x: any) => x.ghlAccountId === "A3")).toMatchObject({ toState: "trial" });
    expect(db.decisions.find((x: any) => x.ghlAccountId === "A3").reason).toMatch(/covered, ignored/);
  });

  it("a NEW trialing subscription → trial with the offer and end date; a repeat run does nothing", async () => {
    const acc = [...accounts(), member({ id: "A8", contactId: "CONTACT8", billingState: null, locationId: "LOC8" })];
    const db = makeFake(acc, ledger());
    setSubs(baseSubs());
    await run(db);
    setSubs([...baseSubs(), { subscriptionId: "S8", contactId: "CONTACT8", status: "trialing", name: "30 Day Trial", trialEnd: "2026-10-28T00:00:00Z" }]);
    await run(db);
    const d = db.decisions.find((x: any) => x.trigger === "sub:S8:trialing");
    expect(d).toMatchObject({ fromState: null, toState: "trial" });
    expect(db.intents.find((i: any) => i.ghlAccountId === "A8").payload.fields).toEqual({ pause_reason: null, trial_offer: "30 Day Trial", trial_end_date: "2026-10-27" });
    const n = db.decisions.length;
    await run(db);
    expect(db.decisions).toHaveLength(n);
  });

  it("contacts with no member account are counted, never an error", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db);
    setSubs([...baseSubs(), { subscriptionId: "S9", contactId: "GHOSTCONTACT", status: "canceled", updatedAt: "2026-09-27T00:00:00Z" }]);
    expect(((await run(db)).summary as any).noAccount).toBeGreaterThanOrEqual(1);
  });

  it("INVOICE BACKSTOP: an expired core recovery invoice emits invoice_expired once; non-core and not-yet-due invoices are ignored", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db);
    const mk = (o: Partial<InvoiceInfo>): InvoiceInfo => ({ id: "INV1", status: "sent", contactId: "CONTACT6", dueDate: D("2026-09-20T00:00:00Z"), amountDue: 57, source: "payments_subscription", isCore: true, ...o });
    feed.invoices = [mk({}), mk({ id: "INV2", isCore: false, source: "manual" }), mk({ id: "INV3", dueDate: D("2099-01-01T00:00:00Z") }), mk({ id: "INV4", status: "paid", amountDue: 0 })];
    const r = await run(db);
    expect((r.summary as any)).toMatchObject({ invoices: 4, invoicesExpired: 1, "emitted:invoice_expired": 1 });
    expect(db.decisions.find((d: any) => d.trigger === "invoice:INV1")).toMatchObject({ ghlAccountId: "A6", toState: "paused", pauseReason: "expired_invoice" });
    await run(db);
    expect(db.decisions.filter((d: any) => d.trigger === "invoice:INV1")).toHaveLength(1);
  });

  it("is RESUMABLE: yielding mid-run returns a cursor and the continuation completes with the same result", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db); // seed
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S1" ? { ...x, status: "canceled", cancelledAt: "2026-09-27T00:00:00Z" } : x)));
    let n = 0;
    const first = await run(db, { shouldYield: () => ++n > 3 });
    expect(first.done).toBe(false);
    expect(first.cursor).toBeDefined();
    let done = first;
    for (let i = 0; i < 20 && !done.done; i++) done = await run(db, { cursor: done.cursor });
    expect(done.done).toBe(true);
    expect(db.decisions.filter((d: any) => d.trigger === "sub:S1:canceled")).toHaveLength(1);
    expect(db.subStates.find((x: any) => x.subscriptionId === "S1").status).toBe("canceled");
  });

  it("the sweep never executes anything in shadow (no pause calls, no GHL writes): only decisions and skipped_shadow intents", async () => {
    const acc = accounts();
    const db = makeFake(acc, ledger()); // account is read-only (no update method): a state write would throw
    setSubs(baseSubs());
    await run(db);
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S1" ? { ...x, status: "canceled", cancelledAt: "2026-09-27T00:00:00Z" } : x)));
    await expect(run(db)).resolves.toMatchObject({ done: true });
    expect(db.intents.every((i: any) => i.status === "skipped_shadow")).toBe(true);
  });
});
