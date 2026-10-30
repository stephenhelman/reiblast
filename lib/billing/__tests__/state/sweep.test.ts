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
  it("churn trigger: one per subscription and outcome (applyDunning suffixes it while the account is exempt)", () => {
    expect(churnTrigger("s1", "canceled")).toBe("sub:s1:canceled");
    expect(churnTrigger("s1", "expired")).toBe("sub:s1:expired");
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
  member({ id: "A2", contactId: "CONTACT2", billingState: "active", locationId: "LOC2", exemptUntil: D("2026-10-15T00:00:00Z") }),
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

  it("EXEMPT CHURN: while exempt the churn is recorded as exempt; once the exemption ends the next run churns — exactly once", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db); // seed (S2 active, A2 covered until 2026-10-15)
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S2" ? { ...x, status: "canceled", updatedAt: "2026-09-27T00:00:00Z" } : x)));
    await run(db);
    const deferred = db.decisions.filter((d: any) => d.ghlAccountId === "A2");
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({ trigger: "sub:S2:canceled:exempt:2026-10-15", toState: "active", sideEffects: [] });
    expect(deferred[0].reason).toMatch(/^exempt until 2026-10-15.*churn/);

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

  it("expired → payment_failed (subscription_expired), NOT churned; unpaid / paused / incomplete_expired and plain active never emit", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db);
    setSubs(baseSubs().map((x) => (x.subscriptionId === "S6" ? { ...x, status: "paused" } : x.subscriptionId === "S5a" ? { ...x, status: "expired" } : x)));
    await run(db);
    expect(db.decisions.filter((d: any) => d.ghlAccountId === "A6")).toHaveLength(0); // unpaid → paused: no event
    const e = db.decisions.find((d: any) => d.ghlAccountId === "A5");
    expect(e).toMatchObject({ trigger: "sub:S5a:expired", toState: "payment_failed", pauseReason: "subscription_expired", coreFailureOpen: true });
  });

  it("TRIAL ENDED (+2 days, no paid core since the trial began) is RECORD-ONLY: a decision, no transition, no side effect, no intent; a converted trial is left alone; runs once", async () => {
    const db = makeFake(accounts(), ledger());
    setSubs(baseSubs());
    await run(db); // seed
    const r = await run(db);
    expect((r.summary as any)).toMatchObject({ trialUnconverted: 1, trialConverted: 1 });
    const d = db.decisions.filter((x: any) => x.eventKind === "trial_ended_unconverted");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ trigger: "sub:S3:trial_ended", ghlAccountId: "A3", fromState: "trial", toState: "trial", reason: "trial ended; awaiting payment-failure or expiry signal", sideEffects: [], intents: [], toStrikes: 0 });
    expect(db.intents.filter((i: any) => i.ghlAccountId === "A3")).toEqual([]);
    await run(db);
    expect(db.decisions.filter((x: any) => x.eventKind === "trial_ended_unconverted")).toHaveLength(1); // idempotent
  });
  it("a trial ended while exempt is recorded under the exempt trigger and again (record-only) once the exemption ends", async () => {
    const acc = accounts();
    acc[2].exemptUntil = D("2026-12-01T00:00:00Z");
    const db = makeFake(acc, ledger());
    setSubs(baseSubs());
    await run(db);
    await run(db);
    expect(db.decisions.find((x: any) => x.ghlAccountId === "A3")).toMatchObject({ toState: "trial", trigger: "sub:S3:trial_ended:exempt:2026-12-01" });
    await run(db, { now: D("2026-12-02T00:00:00Z") });
    expect(db.decisions.filter((x: any) => x.ghlAccountId === "A3").map((x: any) => x.toState)).toEqual(["trial", "trial"]);
  });

  describe("SAFETY NET: trial_unresolved_review", () => {
    const reviews = (db: any) => db.events.filter((e: any) => e.source === "trial_unresolved_review");
    it("a trial that ended > 3 days ago with no core failure / subscription_expired is flagged ONCE per subscription, with no state change", async () => {
      const db = makeFake(accounts(), ledger());
      setSubs(baseSubs());
      await run(db); // seed
      const r = await run(db);
      expect(reviews(db)).toHaveLength(1);
      expect(reviews(db)[0]).toMatchObject({ source: "trial_unresolved_review", externalId: "S3", processedAt: null });
      expect(reviews(db)[0].payload).toMatchObject({ ghlAccountId: "A3", subscriptionId: "S3" });
      expect((r.summary as any).trialUnresolvedFlagged).toBe(1);
      expect(db.decisions.filter((x: any) => x.ghlAccountId === "A3").every((x: any) => x.toState === "trial" && x.sideEffects.length === 0)).toBe(true);
      expect(db.intents.filter((i: any) => i.ghlAccountId === "A3")).toEqual([]);
      await run(db, { now: D("2026-09-30T00:00:00Z") });
      expect(reviews(db)).toHaveLength(1); // never twice
    });
    it("not flagged within 3 days of the trial's end (but the record-only decision is still written)", async () => {
      const db = makeFake(accounts(), ledger());
      setSubs(baseSubs().map((x) => (x.subscriptionId === "S3" ? { ...x, trialEnd: "2026-09-26T00:00:00Z" } : x))); // ended 2.5 days before NOW
      await run(db);
      await run(db);
      expect(db.decisions.some((x: any) => x.eventKind === "trial_ended_unconverted")).toBe(true);
      expect(reviews(db)).toHaveLength(0);
    });
    it("not flagged when a core failure was recorded since the trial ended (decision or failed ledger row)", async () => {
      const a = makeFake(accounts(), ledger());
      setSubs(baseSubs());
      await run(a);
      a.decisions.push({ id: "dx", ghlAccountId: "A3", mode: "shadow", trigger: "ledger:cf", eventKind: "core_failed", eventAt: D("2026-09-22T00:00:00Z"), createdAt: D("2026-09-22T00:00:00Z"), toState: "paused", sideEffects: [] });
      await run(a);
      expect(reviews(a)).toHaveLength(0);
      const b = makeFake(accounts(), [...ledger(), { ghlTransactionId: "f3", ghlAccountId: "A3", classification: "core_subscription", status: "failed", occurredAt: D("2026-09-22T00:00:00Z"), subscriptionId: "S3" }]);
      setSubs(baseSubs());
      await run(b);
      await run(b);
      expect(reviews(b)).toHaveLength(0);
    });
    it("not flagged when a subscription_expired was recorded since; a failure from BEFORE the trial ended does not count", async () => {
      const a = makeFake(accounts(), ledger());
      setSubs(baseSubs());
      await run(a);
      a.decisions.push({ id: "dy", ghlAccountId: "A3", mode: "shadow", trigger: "sub:S3:expired", eventKind: "subscription_expired", eventAt: D("2026-09-23T00:00:00Z"), createdAt: D("2026-09-23T00:00:00Z"), toState: "payment_failed", sideEffects: [] });
      await run(a);
      expect(reviews(a)).toHaveLength(0);
      const b = makeFake(accounts(), ledger());
      await run(b);
      b.decisions.push({ id: "dz", ghlAccountId: "A3", mode: "shadow", trigger: "ledger:old", eventKind: "core_failed", eventAt: D("2026-09-10T00:00:00Z"), createdAt: D("2026-09-10T00:00:00Z"), toState: "paused", sideEffects: [] });
      await run(b);
      expect(reviews(b)).toHaveLength(1);
    });
    it("a dry-run reports it but writes nothing", async () => {
      const db = makeFake(accounts(), ledger());
      setSubs(baseSubs());
      await run(db);
      const r = await run(db, { apply: false });
      expect((r.summary as any).wouldFlagTrialUnresolved).toBe(1);
      expect(reviews(db)).toHaveLength(0);
    });
    it("review rows are never replayed (not a replayable source)", async () => {
      const { REPLAYABLE_SOURCES } = await import("../../processPaymentEvent");
      expect(REPLAYABLE_SOURCES as readonly string[]).not.toContain("trial_unresolved_review");
    });
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

describe("sub_sweep: starting-state seeding for null-state members (shadow mode)", () => {
  const nullAccounts = () => [
    member({ id: "N1", contactId: "CN1", billingState: null, locationId: "LN1" }),
    member({ id: "N2", contactId: "CN2", billingState: null, locationId: "LN2" }),
    member({ id: "N3", contactId: "CN3", billingState: null, locationId: "LN3" }),
    member({ id: "N4", contactId: "CN4", billingState: "paused", pauseReason: "manual_killswitch", locationId: "LN4" }),
    member({ id: "N5", contactId: "CN5", billingState: null, locationId: "LN5" }),
  ];
  const nullSubs = () => [
    { subscriptionId: "SN1", contactId: "CN1", status: "trialing", name: "14 Day Trial", trialEnd: "2026-10-20T00:00:00Z" },
    { subscriptionId: "SN2", contactId: "CN2", status: "active" },
    { subscriptionId: "SN3", contactId: "CN3", status: "unpaid" },
    { subscriptionId: "SN4", contactId: "CN4", status: "active" },
    { subscriptionId: "SN5", contactId: "CN5", status: "paused" },
  ];
  it("--apply seeds trial (offer + end), active and payment_failed for null states; never overwrites; leaves paused subs unseeded; emits no event or intent", async () => {
    const db = makeFake(nullAccounts());
    setSubs(nullSubs());
    const r = await run(db); // first run: seed run, still seeds account states
    const get = (id: string) => db.ghlAccount.findUnique({ where: { id } });
    expect(await get("N1")).toMatchObject({ billingState: "trial", trialOffer: "14 Day Trial", trialEndsAt: new Date("2026-10-20T00:00:00Z") });
    expect(await get("N2")).toMatchObject({ billingState: "active" });
    expect(await get("N3")).toMatchObject({ billingState: "payment_failed" });
    expect(await get("N4")).toMatchObject({ billingState: "paused", pauseReason: "manual_killswitch" }); // untouched
    expect((await get("N5")).billingState).toBeNull();
    expect(db.decisions).toHaveLength(0);
    expect(db.intents).toHaveLength(0);
    expect(r.summary as any).toMatchObject({ "seeded:trial": 1, "seeded:active": 1, "seeded:payment_failed": 1, seedSkipped: 1 });
  });
  it("dry-run writes nothing and reports wouldSeed", async () => {
    const db = makeFake(nullAccounts());
    setSubs(nullSubs());
    const r = await run(db, { apply: false });
    expect((await db.ghlAccount.findUnique({ where: { id: "N1" } })).billingState).toBeNull();
    expect(r.summary as any).toMatchObject({ "wouldSeed:trial": 1, "wouldSeed:active": 1 });
  });
  it("an expired subscription on a null-state account becomes payment_failed / subscription_expired through the event path", async () => {
    const acct = member({ id: "N1", contactId: "CN1", billingState: null });
    const db = makeFake([acct]);
    setSubs([{ subscriptionId: "SN1", contactId: "CN1", status: "active" }]);
    await run(db); // first run seeds GhlSubscriptionState (and the account: active)
    acct.billingState = null; // …pretend it is still unseeded when the expiry is seen
    setSubs([{ subscriptionId: "SN1", contactId: "CN1", status: "expired" }]);
    await run(db);
    expect(await db.ghlAccount.findUnique({ where: { id: "N1" } })).toMatchObject({ billingState: "payment_failed", pauseReason: "subscription_expired" });
  });
});

