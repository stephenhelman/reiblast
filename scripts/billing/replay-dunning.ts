/**
 * Historical replay of the billing state engine over every member's ledger. Shadow only: --apply writes DunningDecision rows with
 * mode "replay" (idempotent) and NOTHING else — no GhlAccount update, no GHL write, no side effect.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/replay-dunning.ts [--skip-subscription-reads] [--member=OrCc,GM2p]        # dry-run (default)
 *   PRISMA_TARGET=dev npx tsx scripts/billing/replay-dunning.ts --apply
 *
 * Each member starts from a neutral projected state (trial if their first core-related row is a trial_auth, else active); their
 * ledger events run through decide() in occurredAt order. Wallet balances come from a real snapshot taken shortly before the
 * event, otherwise they are ESTIMATED by reconstructing back from the nearest snapshot (wallet usage + ledger recharge credits). The
 * balance is needed for a wallet FAILURE (strike only if negative) and for a recharge SUCCESS that could cure (resume/clear only if the
 * post-recharge balance is >= 0);
 * with no usable snapshot the balance is unknown and no strike is counted. coreCoveredUntil is checked at each event's own time.
 * Reads from GHL (GET only): one subscription per trial_auth event. Refuses the production host.
 */
import { Prisma } from "@prisma/client";
import { apiStats } from "../../lib/billing/ghlWallet";
import { nearestAnchor, resolveReplayBalance, type Credit, type SnapshotLite } from "../../lib/billing/state/balance";
import { decisionRow, recordDecision } from "../../lib/billing/state/apply";
import { eventFromLedger } from "../../lib/billing/state/events";
import { milestones, replayAccount, seedSnapshot, type ReplayEvent, type ReplayStep } from "../../lib/billing/state/replay";
import { fetchSubscription } from "../../lib/billing/state/subscription";
import type { BalanceReading, BillingState, SubscriptionInfo } from "../../lib/billing/state/types";
import { sub as msub, sumOf, ZERO } from "../../lib/billing/reports/money";
import { connect } from "./_cli";

const { db, apply } = await connect();
const skipSubs = process.argv.includes("--skip-subscription-reads");
const memberFilter = (process.argv.find((a) => a.startsWith("--member="))?.slice(9) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const last4 = (s: string | null | undefined) => (s ? `…${s.slice(-4)}` : "(no location)");
const day = (d: Date) => d.toISOString().slice(5, 10);
const tally = <T extends string>(m: Map<T, number>, k: T, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

async function usageSums(scopeKey: string, anchorAt: Date, times: Date[]): Promise<Map<number, string>> {
  const rows = await db.$queryRaw<{ i: bigint; s: string }[]>`
    SELECT u.i AS i, COALESCE(SUM(w."amount"), 0)::text AS s
    FROM unnest(${times.map((t) => t.toISOString())}::timestamp[]) WITH ORDINALITY AS u(t, i)
    LEFT JOIN "WalletTransaction" w ON w."scopeKey" = ${scopeKey} AND (
         (u.t <  ${anchorAt.toISOString()}::timestamp AND w."settlementTime" > u.t AND w."settlementTime" <= ${anchorAt.toISOString()}::timestamp)
      OR (u.t >= ${anchorAt.toISOString()}::timestamp AND w."settlementTime" > ${anchorAt.toISOString()}::timestamp AND w."settlementTime" <= u.t))
    GROUP BY u.i`;
  const out = new Map<number, string>();
  for (const r of rows) out.set(times[Number(r.i) - 1].getTime(), r.s);
  return out;
}

async function main() {
  const [members, ledger, snaps] = await Promise.all([
    db.ghlAccount.findMany({
      where: { accountType: "member" },
      select: { id: true, locationId: true, billingState: true, warningCount: true, pauseReason: true, coreCoveredUntil: true, user: { select: { status: true, warningCount: true } } },
    }),
    db.billingLedgerEntry.findMany({ orderBy: { occurredAt: "asc" }, select: { ghlTransactionId: true, classification: true, status: true, ghlAccountId: true, occurredAt: true, subscriptionId: true, amount: true, amountRefunded: true } }),
    db.walletBalanceSnapshot.findMany({ select: { locationId: true, status: true, balance: true, createdAt: true } }),
  ]);
  const memberIds = new Set(members.map((m) => m.id));
  const rowsBy = new Map<string, typeof ledger>();
  for (const r of ledger) if (r.ghlAccountId && memberIds.has(r.ghlAccountId)) (rowsBy.get(r.ghlAccountId) ?? rowsBy.set(r.ghlAccountId, []).get(r.ghlAccountId)!).push(r);
  const snapsBy = new Map<string, SnapshotLite[]>();
  for (const s of snaps) (snapsBy.get(s.locationId) ?? snapsBy.set(s.locationId, []).get(s.locationId)!).push({ at: s.createdAt, status: s.status, balance: s.balance === null ? null : s.balance.toFixed(6) });

  // ── events and the plan (before any GHL call) ─────────────────────────────
  const perAccount = new Map<string, ReplayEvent[]>();
  const skipped = new Map<string, number>();
  const kinds = new Map<string, number>();
  for (const m of members) {
    const evs: ReplayEvent[] = [];
    for (const r of rowsBy.get(m.id) ?? []) {
      const e = eventFromLedger(r);
      if (!e.ok) { tally(skipped, e.skip); continue; }
      evs.push(e.value);
      tally(kinds, e.value.event.kind);
    }
    if (evs.length) perAccount.set(m.id, evs);
  }
  const subIds = [...new Set([...perAccount.values()].flat().filter((e) => e.event.kind === "trial_auth_succeeded" && e.subscriptionId).map((e) => e.subscriptionId as string))];
  console.log(`Members: ${members.length} (${perAccount.size} with replayable events)   ledger rows: ${ledger.length}   balance snapshots: ${snaps.length}`);
  console.log("Events:", Object.fromEntries([...kinds].sort()));
  console.log("Skipped rows (no rule / not terminal / unmatched):", Object.fromEntries([...skipped].sort()));
  console.log("\nPLAN (before any GHL call):");
  console.log(`  GET /payments/subscriptions/{id}: ${skipSubs ? "0 (--skip-subscription-reads)" : subIds.length}`);
  console.log(`  wallet-usage SQL queries (balance reconstruction): about ${[...perAccount.entries()].filter(([id, evs]) => evs.some((e) => e.event.kind === "wallet_recharge_failed" || e.event.kind === "wallet_recharge_succeeded") && members.find((m) => m.id === id)?.locationId && snapsBy.has(members.find((m) => m.id === id)!.locationId as string)).length}, database only`);
  console.log(`  writes: ${apply ? "DunningDecision rows, mode replay (idempotent)" : "none (dry-run)"}\n`);

  const subMap = new Map<string, SubscriptionInfo | null>();
  if (!skipSubs) for (const id of subIds) subMap.set(id, await fetchSubscription(id).catch(() => null));
  const subRead = [...subMap.values()];
  console.log(`GHL calls made: ${apiStats.calls}${skipSubs ? "" : `   subscriptions read: ${subRead.filter(Boolean).length} of ${subIds.length}, with a "N Day Trial" name: ${subRead.filter((x) => x?.name && /\d+\s*Day Trial/i.test(x.name)).length}, with a trial end date: ${subRead.filter((x) => x?.trialEndsAt).length}`}\n`);

  // ── replay ────────────────────────────────────────────────────────────────
  type Result = { m: (typeof members)[number]; steps: ReplayStep[]; final: ReturnType<typeof replayAccount>["final"] };
  const results: Result[] = [];
  let est = 0, unknownBal = 0, realBal = 0;
  for (const m of members) {
    const evs = perAccount.get(m.id);
    const rows = rowsBy.get(m.id) ?? [];
    if (!evs) continue;
    const snapshots = m.locationId ? (snapsBy.get(m.locationId) ?? []) : [];
    const credits: Credit[] = rows
      .filter((r) => r.status === "succeeded" && (r.classification === "wallet_auto_recharge" || r.classification === "wallet_manual_recharge"))
      .map((r) => ({ at: r.occurredAt, amount: msub(r.amount.toFixed(6), r.amountRefunded.toFixed(6)) }));

    // precompute usage sums for every failed-wallet event that needs an estimate (grouped by anchor)
    const failed = evs.filter((e) => e.event.kind === "wallet_recharge_failed" || e.event.kind === "wallet_recharge_succeeded"); // balance may be needed for both
    const byAnchor = new Map<number, { at: Date; times: Date[] }>();
    for (const e of failed) {
      const a = nearestAnchor(snapshots, e.eventAt);
      if (!a || !m.locationId) continue;
      (byAnchor.get(a.at.getTime()) ?? byAnchor.set(a.at.getTime(), { at: a.at, times: [] }).get(a.at.getTime())!).times.push(e.eventAt);
    }
    const usage = new Map<string, string>();
    for (const { at, times } of byAnchor.values()) {
      const sums = await usageSums(m.locationId as string, at, times);
      for (const t of times) usage.set(`${at.getTime()}|${t.getTime()}`, sums.get(t.getTime()) ?? ZERO);
    }
    const balances = new Map<string, BalanceReading>();
    for (const e of failed) {
      const r = resolveReplayBalance({ snapshots, t: e.eventAt, credits, usageBetween: (anchorAt, t) => usage.get(`${anchorAt.getTime()}|${t.getTime()}`) ?? null });
      balances.set(e.trigger, r);
    }
    const out = replayAccount(evs, {
      seed: seedSnapshot(rows),
      coveredUntil: m.coreCoveredUntil,
      balanceFor: (e) => balances.get(e.trigger),
      subscriptionFor: (e) => (skipSubs ? null : e.subscriptionId ? (subMap.get(e.subscriptionId) ?? null) : null),
    });
    for (const s of out.steps) if (s.balance) { if (s.balance.status !== "ok") unknownBal++; else if (s.balance.estimated) est++; else realBal++; }
    results.push({ m, steps: out.steps, final: out.final });
    if (apply) for (const s of out.steps) await recordDecision(db, decisionRow({ ghlAccountId: m.id, trigger: s.trigger, eventAt: s.eventAt, event: evs.find((e) => e.trigger === s.trigger)!.event, from: s.from, decision: s.decision, mode: "replay", balance: s.balance }));
  }

  // ── report ────────────────────────────────────────────────────────────────
  const strikesTotal = new Map<string, number>();
  let strikeEvents = 0, coveredIgnored = 0, pf = 0, resumes = 0, pausesTotal = 0, notCured = 0, cured = 0;
  const pauses = new Map<string, number>();
  const finalStates = new Map<string, number>();
  const timeline: string[] = [];
  let quiet = 0;
  for (const r of results) {
    for (const s of r.steps) if (s.eventKind === "wallet_recharge_succeeded") { if (/balance still negative|balance unknown/.test(s.decision.reason)) notCured++; else if (s.decision.sideEffects.some((e) => e.type === "saas_resume") || /payment_failed → active/.test(s.decision.reason)) cured++; }
    const ms = milestones(r.steps);
    for (const x of ms) {
      if (x.kind === "strike") strikeEvents++;
      if (x.kind === "covered_ignored") coveredIgnored++;
      if (x.kind === "payment_failed") pf++;
      if (x.kind === "resumed") resumes++;
      if (x.kind === "paused") { pausesTotal++; tally(pauses, x.detail); }
    }
    tally(finalStates, r.final.state ?? "null");
    const interesting = ms.filter((x) => x.kind !== "trial");
    if (!interesting.length) { quiet++; continue; }
    const actual = `${r.m.billingState ?? "null"}${r.m.pauseReason ? `/${r.m.pauseReason}` : ""} · User ${r.m.user?.status ?? "?"} w${r.m.user?.warningCount ?? 0}`;
    timeline.push(`  ${last4(r.m.locationId)}  ${interesting.map((x) => `${day(x.at)} ${x.detail}`).join(" → ")}\n        replay end: ${r.final.state}${r.final.pauseReason ? `/${r.final.pauseReason}` : ""} strikes=${r.final.strikes}   |   actual today: ${actual}`);
  }
  console.log("PER MEMBER (strikes, pauses, resumes, payment_failed episodes; members with none omitted):");
  for (const t of timeline) console.log(t);
  console.log(`  (${quiet} members had no strike, pause, resume or payment_failed episode)\n`);

  console.log("TOTALS");
  console.log(`  events replayed: ${[...results].reduce((n, r) => n + r.steps.length, 0)}   members: ${results.length}`);
  console.log(`  counted strikes: ${strikeEvents}   pauses: ${pausesTotal} ${JSON.stringify(Object.fromEntries(pauses))}   resumes: ${resumes}   payment_failed episodes started: ${pf}   core failures ignored (covered): ${coveredIgnored}`);
  console.log(`  recharge successes that CURED (balance >= 0: resumed / cleared payment_failed): ${cured}   that did NOT cure (balance still negative / unknown → strikes reset, state stays): ${notCured}`);
  console.log(`  wallet-failure balances used — real snapshot: ${realBal}, ESTIMATED: ${est}, unknown (strike not counted): ${unknownBal}`);
  console.log("  replay final state distribution:", Object.fromEntries([...finalStates].sort()));

  console.log("\nCOMPARISON with today's actual (GhlAccount.billingState / User.status / User.warningCount)");
  const matrix = new Map<string, number>();
  let suspendedAgree = 0, projPausedNotSusp = 0, suspNotProjPaused = 0, strikeAgree = 0, strikeDiff = 0;
  for (const r of results) {
    tally(matrix, `${r.final.state ?? "null"} → actual ${r.m.billingState ?? "null"}`);
    const susp = r.m.user?.status === "suspended";
    const projPaused = r.final.state === "paused";
    if (susp && projPaused) suspendedAgree++; else if (projPaused) projPausedNotSusp++; else if (susp) suspNotProjPaused++;
    if ((r.m.user?.warningCount ?? 0) === r.final.strikes) strikeAgree++; else strikeDiff++;
  }
  console.log("  replay-final → GhlAccount.billingState (count):");
  for (const [k, n] of [...matrix].sort()) console.log(`    ${k.padEnd(34)} ${n}`);
  console.log(`  User.status suspended vs replay paused: both ${suspendedAgree}, replay-paused-only ${projPausedNotSusp}, suspended-only ${suspNotProjPaused}`);
  console.log(`  strikes replay == User.warningCount: ${strikeAgree} members; differ: ${strikeDiff}`);
  console.log("  Note: replay sees only ledger payments — manual pauses/resumes, GHL stage moves and pre-June history are not in it.");
  for (const r of results.filter((x) => memberFilter.some((f) => (x.m.locationId ?? "").endsWith(f)))) {
    console.log(`\nSTEPS for ${last4(r.m.locationId)} (${r.steps.length} events; each line: date event  state→state strikes :: reason)`);
    for (const s of r.steps) console.log(`  ${s.eventAt.toISOString().slice(0, 16).replace("T", " ")}  ${s.eventKind.padEnd(26)} ${String(s.from.state).padEnd(14)}→ ${String(s.decision.nextState).padEnd(14)} s${s.from.strikes}→${s.decision.warningCount}${s.decision.noop ? "  (no change)" : ""}  :: ${s.decision.reason}`);
  }

  console.log(apply ? `\nApplied: DunningDecision rows written with mode "replay".` : "\nDry-run: nothing written. Re-run with --apply.");
}

main().finally(() => db.$disconnect());
