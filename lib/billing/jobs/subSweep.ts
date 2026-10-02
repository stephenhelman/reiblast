import type { PrismaClient } from "@prisma/client";
import { applyInvoice } from "../events/invoiceEvent";
import { invoiceExpiry, listInvoicesPage } from "../invoices";
import { listSubscriptionsPage, type SubRow } from "../subscriptions";
import { applyDunning, dunningMode } from "../state/apply";
import { loadProjection } from "../state/projection";
import { churnTrigger, hasOtherLiveSubscription, transitionEvents, trialEndedTrigger, trialEndedWithoutRelationshipEnd } from "../state/sweepRules";
import { decide } from "../state/transition";
import type { DunningEvent, SubscriptionInfo } from "../state/types";
import type { JobFn } from "./types";

/**
 * Nightly subscription sweep ("sub_sweep"). Subscription status changes (canceled, expired, trial expired without converting) produce NO
 * ledger event, so this job feeds them to the dunning engine.
 *
 *  - FIRST RUN (GhlSubscriptionState empty): seeds the state table WITHOUT emitting any event, and reports what it would have emitted.
 *  - Later runs: emit on a status change — canceled/expired → churned (deferred while covered; a cancel during the trial churns at once),
 *    newly trialing → trial. Every run also (a) settles coverage-deferred churns whose coverage has ended, (b) flags trials that ended
 *    (+2 days) with no succeeded core payment since the trial began, and (c) backstops invoice expiry (GHL has no "expired" status).
 *  - A canceled/expired subscription NEVER churns an account whose contact still holds another live subscription (trialing/active/unpaid).
 *  - `unpaid`, `paused`, `incomplete_expired` never emit (unpaid is shown on Health).
 *  - Dry-run (no --apply) writes nothing at all and reports what it would emit.
 */
const PAGE = 100;

type Phase = "list" | "events" | "settle" | "trial" | "invoices";
/** Everything phase 1 read, so the later phases (and a dry-run / seed, which write no state) all work from one consistent listing. */
type Seen = { id: string; contactId: string; status: string; prev: string | null; name: string | null; trialEndsAt: string | null; cancelledAt: string | null; updatedAt: string | null };
type Cursor = { phase: Phase; offset: number; invOffset: number; evIdx: number; seed: boolean; acc: Record<string, number>; sample: string[]; seen: Seen[] };

const last4 = (s: string) => `…${s.slice(-4)}`;
const asRow = (s: Seen): Pick<SubRow, "status" | "trialEndsAt" | "cancelledAt" | "updatedAt"> => ({ status: s.status, trialEndsAt: s.trialEndsAt ? new Date(s.trialEndsAt) : null, cancelledAt: s.cancelledAt ? new Date(s.cancelledAt) : null, updatedAt: s.updatedAt ? new Date(s.updatedAt) : null });

export const runSubSweep: JobFn = async (ctx) => {
  const db = ctx.db;
  const c = ctx.cursor as Cursor | null;
  const seed = c?.seed ?? (await db.ghlSubscriptionState.count()) === 0;
  const st: Cursor = { phase: c?.phase ?? "list", offset: c?.offset ?? 0, invOffset: c?.invOffset ?? 0, evIdx: c?.evIdx ?? 0, seed, acc: c?.acc ?? {}, sample: c?.sample ?? [], seen: c?.seen ?? [] };
  const bump = (k: string, n = 1) => (st.acc[k] = (st.acc[k] ?? 0) + n);
  const note = (s: string) => { if (st.sample.length < 40) st.sample.push(s); };
  /** Emit for real only on an applying, non-seed run; otherwise preview (nothing written to the engine tables). */
  const emitting = ctx.apply && !seed;
  const mode = dunningMode();
  const summary = () => ({ ...st.acc, seed, dryRun: !ctx.apply, emitting, phase: st.phase, offset: st.offset, seenCount: st.seen.length, sample: st.sample });
  const yieldNow = () => ({ done: false as const, cursor: st as unknown as Record<string, unknown>, summary: summary() });

  /** Run (or preview) one engine event for the account owning `contactId`. */
  async function fire(contactId: string, event: DunningEvent, trigger: string, info?: SubscriptionInfo | null) {
    const account = await db.ghlAccount.findFirst({ where: { contactId, accountType: "member" }, select: { id: true, coreCoveredUntil: true } });
    if (!account) return bump("noAccount");
    if (emitting) {
      const r = await applyDunning(db, { ghlAccountId: account.id, trigger, event, eventAt: ctx.now, subscriptionInfo: info }, { mode, deps: { now: () => ctx.now } }); // the job's clock, so coverage is judged at the sweep's own time
      if (r.status === "recorded") {
        bump(`emitted:${event.kind}`);
        bump(r.decision.noop ? "decisionNoop" : "decisionChanged");
        bump(`transition:${r.decision.nextState ?? "—"}:${event.kind}`);
        if (!r.decision.noop) note(`${last4(contactId)} ${event.kind} → ${r.decision.nextState ?? "—"}: ${r.decision.reason}`);
      } else bump(`applyDunning:${r.status}`);
      return;
    }
    // preview: decide against the current shadow projection, write nothing
    const proj = await loadProjection(db, account.id, "shadow");
    if (!proj) return bump("noAccount");
    const d = decide(proj, event, { now: ctx.now, coveredUntil: account.coreCoveredUntil, subscription: info ?? undefined });
    bump(`wouldEmit:${event.kind}`);
    bump(d.noop ? "wouldNoop" : "wouldChange");
    bump(`wouldTransition:${proj.state ?? "unseeded"}→${d.nextState ?? "—"}${d.noop ? " (no change)" : ""} on ${event.kind}`);
    if (proj.state !== d.nextState) note(`${last4(contactId)} ${event.kind}: ${proj.state ?? "unseeded"} → ${d.nextState ?? "—"} — ${d.reason}`); // a trial→trial refresh is routine
  }

  // ── phase 1: read every subscription, upsert state ────────────────────────
  if (st.phase === "list") {
    for (;;) {
      if (ctx.shouldYield()) return yieldNow();
      const rows: SubRow[] = await listSubscriptionsPage(st.offset, PAGE);
      for (const sub of rows) {
        bump("subscriptions");
        bump(`status:${sub.status}`);
        const prev = await db.ghlSubscriptionState.findUnique({ where: { subscriptionId: sub.subscriptionId }, select: { status: true } });
        if (prev && prev.status !== sub.status) bump("statusChanged");
        st.seen.push({ id: sub.subscriptionId, contactId: sub.contactId, status: sub.status, prev: seed ? null : (prev?.status ?? null), name: sub.name, trialEndsAt: sub.trialEndsAt?.toISOString() ?? null, cancelledAt: sub.cancelledAt?.toISOString() ?? null, updatedAt: sub.updatedAt?.toISOString() ?? null });
        if (ctx.apply) {
          await db.ghlSubscriptionState.upsert({
            where: { subscriptionId: sub.subscriptionId },
            create: { subscriptionId: sub.subscriptionId, contactId: sub.contactId, status: sub.status, name: sub.name, trialEndsAt: sub.trialEndsAt, lastSeenAt: ctx.now },
            update: { contactId: sub.contactId, status: sub.status, name: sub.name, trialEndsAt: sub.trialEndsAt, lastSeenAt: ctx.now },
          });
        }
      }
      st.offset += rows.length;
      if (rows.length < PAGE) break;
    }
    st.phase = "events";
  }

  // ── phase 2: status-change events (needs the FULL listing for the other-live-subscription guard) ──
  if (st.phase === "events") {
    for (; st.evIdx < st.seen.length; st.evIdx++) {
      if (ctx.shouldYield()) return yieldNow();
      const s = st.seen[st.evIdx];
      for (const ch of transitionEvents(asRow(s), s.prev, ctx.now)) {
        const isChurn = ch.event.kind === "subscription_canceled" || ch.event.kind === "subscription_expired";
        if (isChurn && hasOtherLiveSubscription(st.seen, s)) {
          bump("churnSkippedOtherLiveSubscription");
          note(`${last4(s.contactId)} ${ch.event.kind}: skipped — the contact still has another live subscription`);
          continue;
        }
        const covered = isChurn ? (await db.ghlAccount.findFirst({ where: { contactId: s.contactId, accountType: "member" }, select: { coreCoveredUntil: true } }))?.coreCoveredUntil ?? null : null;
        const trigger = ch.suffix === "trialing" ? `sub:${s.id}:trialing` : churnTrigger(s.id, ch.suffix, { duringTrial: ch.event.kind === "subscription_canceled" && ch.event.duringTrial, coveredUntil: covered, now: ctx.now });
        await fire(s.contactId, ch.event, trigger, { name: s.name, trialEndsAt: s.trialEndsAt ? new Date(s.trialEndsAt) : null });
      }
    }
    st.phase = "settle";
  }

  // ── phase 3: coverage-deferred churn whose coverage has ended ─────────────
  if (st.phase === "settle") {
    for (const s of st.seen.filter((x) => x.status === "canceled" || x.status === "expired")) {
      if (ctx.shouldYield()) return yieldNow();
      if (hasOtherLiveSubscription(st.seen, s)) continue;
      const acct = await db.ghlAccount.findFirst({ where: { contactId: s.contactId, accountType: "member", coreCoveredUntil: { not: null, lte: ctx.now } }, select: { id: true } });
      if (!acct) continue; // never covered, or still covered — handled when the status changed / deferred until coverage ends
      bump("settleCandidates");
      const expired = s.status === "expired";
      await fire(s.contactId, expired ? { kind: "subscription_expired" } : { kind: "subscription_canceled", duringTrial: false }, `sub:${s.id}:${expired ? "expired" : "canceled"}`);
    }
    st.phase = "trial";
  }

  // ── phase 4: trials that ended (+2 days) without a paid core subscription ─
  if (st.phase === "trial") {
    for (const s of st.seen) {
      if (ctx.shouldYield()) return yieldNow();
      const trialEndsAt = s.trialEndsAt ? new Date(s.trialEndsAt) : null;
      if (!trialEndedWithoutRelationshipEnd({ status: s.status, trialEndsAt }, ctx.now)) continue;
      const acct = await db.ghlAccount.findFirst({ where: { contactId: s.contactId, accountType: "member" }, select: { id: true } });
      if (!acct) continue;
      const started = await db.billingLedgerEntry.findFirst({ where: { ghlAccountId: acct.id, classification: "trial_auth", subscriptionId: s.id }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } });
      const since = started?.occurredAt ?? new Date((trialEndsAt as Date).getTime() - 31 * 864e5);
      const paid = await db.billingLedgerEntry.findFirst({ where: { ghlAccountId: acct.id, classification: "core_subscription", status: "succeeded", occurredAt: { gte: since } }, select: { ghlTransactionId: true } });
      if (paid) { bump("trialConverted"); continue; }
      bump("trialUnconverted");
      await fire(s.contactId, { kind: "trial_ended_unconverted" }, trialEndedTrigger(s.id));
    }
    st.phase = "invoices";
  }

  // ── phase 5: invoice-expiry backstop (GHL has no "expired" invoice status) ─
  if (st.phase === "invoices") {
    for (;;) {
      if (ctx.shouldYield()) return yieldNow();
      const invoices = await listInvoicesPage(st.invOffset, PAGE);
      for (const inv of invoices) {
        bump("invoices");
        if (!inv.isCore || !invoiceExpiry(inv, ctx.now).expired) continue;
        bump("invoicesExpired");
        if (emitting) {
          const r = await applyInvoice(db as PrismaClient, inv, { deps: { now: () => ctx.now } });
          if (r.acted) bump("emitted:invoice_expired");
          note(`invoice …${inv.id.slice(-4)}: ${r.why}`);
        } else note(`invoice …${inv.id.slice(-4)} would emit invoice_expired (${invoiceExpiry(inv, ctx.now).why})`);
      }
      st.invOffset += invoices.length;
      if (invoices.length < PAGE) break;
    }
  }

  return { done: true, summary: summary() };
};
