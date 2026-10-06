/**
 * Shadow-period soak report. READ-ONLY: only findMany/aggregate/count queries — nothing is written to the database or to GHL.
 * Refuses --apply. The production guard is the shared connect() (BILLING_DB_TARGET=prod + --i-mean-production + typed host).
 *
 *   BILLING_DB_TARGET=prod npx tsx scripts/billing/soak-report.ts --i-mean-production [--since=2026-10-01]
 *
 * The period starts at the earliest mode=shadow DunningDecision's eventAt (or --since). Classification logic: lib/billing/reports/soak.ts.
 */
import { classifyMember, classifyStageName, coverageChecklist, countBy, failedEffects, hasActivity, INTENDED_LABELS, intentIsStuck, isProcessingError, maskId, transitionKey, type DecisionLite, type IntendedKey, type LegacyEvidence, type StageMove, type Verdict } from "../../lib/billing/reports/soak";
import { arg, connect } from "./_cli";

if (process.argv.includes("--apply")) throw new Error("soak-report is read-only; --apply is not supported.");

const { db } = await connect();
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + "Z" : "-");
const h = (t: string) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);
const pad = (s: string | number, n: number) => String(s).padEnd(n);

async function main() {
  const now = new Date();
  let since: Date;
  const sinceArg = arg("since");
  if (sinceArg) {
    since = new Date(sinceArg);
    if (Number.isNaN(since.getTime())) throw new Error(`--since "${sinceArg}" is not a date.`);
  } else {
    const first = await db.dunningDecision.aggregate({ where: { mode: "shadow" }, _min: { eventAt: true } });
    if (!first._min.eventAt) {
      console.log("No mode=shadow DunningDecision rows exist and no --since given: nothing to report.");
      return;
    }
    since = first._min.eventAt;
  }
  console.log(`Soak period: ${iso(since)} -> ${iso(now)} (${((now.getTime() - since.getTime()) / 864e5).toFixed(1)} days)${sinceArg ? "  [--since]" : "  [earliest shadow decision]"}`);

  const rows = await db.dunningDecision.findMany({ where: { mode: "shadow", eventAt: { gte: since } }, orderBy: [{ eventAt: "asc" }, { createdAt: "asc" }] });
  const decisions: (DecisionLite & { id: string })[] = rows.map((r) => ({
    id: r.id, ghlAccountId: r.ghlAccountId, trigger: r.trigger, eventKind: r.eventKind, eventAt: r.eventAt, fromState: r.fromState, toState: r.toState,
    fromStrikes: r.fromStrikes, toStrikes: r.toStrikes, pauseReason: r.pauseReason, sideEffects: r.sideEffects, intents: r.intents, reason: r.reason,
    walletBalance: r.walletBalance === null ? null : r.walletBalance.toFixed(6),
  }));

  const accounts = await db.ghlAccount.findMany({
    where: { accountType: "member" },
    select: { id: true, userId: true, contactId: true, locationName: true, billingState: true, user: { select: { businessName: true, status: true, warningCount: true } } },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byContact = new Map(accounts.map((a) => [a.contactId, a]));
  const label = (a: (typeof accounts)[number] | undefined, fallback?: string | null) =>
    a ? `${maskId(a.contactId)} ${a.user?.businessName ?? a.locationName ?? "(unnamed)"}` : `${maskId(fallback)} (no member account)`;

  const [txns, stageEvents, intents, handoffEvents] = await Promise.all([
    db.transaction.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, paymentStatus: true, createdAt: true } }),
    db.ghlEvent.findMany({ where: { source: { in: ["stage_change", "stage_change_unmapped"] }, receivedAt: { gte: since } }, orderBy: { receivedAt: "asc" }, select: { id: true, source: true, externalId: true, payload: true, receivedAt: true, processedAt: true, lastError: true } }),
    db.ghlIntent.findMany({ where: { createdAt: { gte: since } }, select: { id: true, ghlAccountId: true, kind: true, pipeline: true, dedupeKey: true, status: true, attempts: true, lastError: true, createdAt: true } }),
    db.ghlEvent.findMany({ where: { source: "client_handoff_review", receivedAt: { gte: since } }, select: { externalId: true } }),
  ]);

  // ── 1. event coverage ─────────────────────────────────────────────────────
  h("1. EVENT COVERAGE (shadow decisions)");
  console.log(`Shadow decisions: ${decisions.length}   members with a decision: ${new Set(decisions.map((d) => d.ghlAccountId)).size}`);
  console.log("\nBy event kind:");
  for (const [k, n] of countBy(decisions, (d) => d.eventKind)) console.log(`  ${pad(k, 32)} ${n}`);
  console.log("\nBy transition (from -> to):");
  for (const [k, n] of countBy(decisions, transitionKey)) console.log(`  ${pad(k, 32)} ${n}`);
  const handoffs = intents.filter((i) => i.dedupeKey.startsWith("handoff:") || i.dedupeKey.startsWith("handoff-shadow:"));
  console.log("\nSituation checklist (seen at least once in the period?):");
  const checklist = coverageChecklist(decisions, handoffs.length);
  for (const c of checklist) console.log(`  [${c.count > 0 ? "x" : " "}] ${pad(c.label, 56)} ${pad(c.count, 5)} ${c.lastAt ? `last ${iso(c.lastAt)}` : ""}`);
  const missing = checklist.filter((c) => c.count === 0);
  console.log(`\n  Not yet seen: ${missing.length ? missing.map((c) => c.label).join("; ") : "none — all situations covered"}`);
  if (handoffEvents.length) console.log(`  Handoffs reaching A2P Approved with null billingState (listed for review): ${handoffEvents.length}`);

  // ── 2. engine vs legacy ───────────────────────────────────────────────────
  h("2. ENGINE vs LEGACY (per member with any activity)");
  console.log("Legacy evidence: Transaction rows (failures), current User.warningCount / User.status (no history is kept), and stage_change");
  console.log("events (cards moved to Paused / Payment Failed / Active Member). stage_change events may also be manual moves by staff.\n");
  const decByAcct = new Map<string, DecisionLite[]>();
  for (const d of decisions) (decByAcct.get(d.ghlAccountId) ?? decByAcct.set(d.ghlAccountId, []).get(d.ghlAccountId)!).push(d);
  const acctByUser = new Map(accounts.map((a) => [a.userId, a.id]));
  const legacyBy = new Map<string, LegacyEvidence>();
  const legacyOf = (id: string): LegacyEvidence => {
    let l = legacyBy.get(id);
    if (!l) {
      const a = byId.get(id);
      l = { failTxns: 0, warningCount: a?.user?.warningCount ?? 0, userStatus: a?.user?.status ?? null, moves: [] };
      legacyBy.set(id, l);
    }
    return l;
  };
  for (const t of txns) {
    const id = acctByUser.get(t.userId);
    if (id && t.paymentStatus.toLowerCase() !== "success") legacyOf(id).failTxns++;
  }
  const parseStage = (p: unknown): { pipeline: string; stage: string } | null => {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    const cd = o.customData && typeof o.customData === "object" ? (o.customData as Record<string, unknown>) : {};
    const pipeline = cd.pipeline ?? o.pipeline;
    const stage = cd.stage ?? o.stage;
    return typeof pipeline === "string" && typeof stage === "string" ? { pipeline, stage: stage.trim() } : null;
  };
  for (const e of stageEvents) {
    if (e.source !== "stage_change") continue;
    const a = e.externalId ? byContact.get(e.externalId) : undefined;
    const p = parseStage(e.payload);
    if (a && p) legacyOf(a.id).moves.push({ at: e.receivedAt, pipeline: p.pipeline, stage: p.stage } satisfies StageMove);
  }
  const ids = new Set([...decByAcct.keys(), ...legacyBy.keys()]);
  const verdicts = new Map<Verdict, string[]>();
  const intendedHits = new Map<IntendedKey, string[]>();
  let activeMembers = 0;
  for (const id of ids) {
    const ds = decByAcct.get(id) ?? [];
    const l = legacyOf(id);
    if (!hasActivity(ds, l)) continue;
    activeMembers++;
    const c = classifyMember(ds, l);
    const who = label(byId.get(id));
    (verdicts.get(c.verdict) ?? verdicts.set(c.verdict, []).get(c.verdict)!).push(`${pad(who, 44)} ${c.line}`);
    for (const k of c.intended) (intendedHits.get(k) ?? intendedHits.set(k, []).get(k)!).push(who);
  }
  console.log(`Members with activity: ${activeMembers}`);
  for (const v of ["agree", "engine-only action", "legacy-only action", "different outcome"] as Verdict[]) {
    const list = verdicts.get(v) ?? [];
    console.log(`\n${v.toUpperCase()} (${list.length})`);
    for (const line of list) console.log(`  ${line}`);
  }

  // ── 3. intended differences ───────────────────────────────────────────────
  h("3. KNOWN INTENDED DIFFERENCES (engine design, not defects)");
  for (const k of Object.keys(INTENDED_LABELS) as IntendedKey[]) {
    const who = intendedHits.get(k) ?? [];
    console.log(`- ${INTENDED_LABELS[k]}: ${who.length} member(s)${who.length ? "\n    " + who.join("\n    ") : ""}`);
  }

  // ── 4. health ─────────────────────────────────────────────────────────────
  h("4. HEALTH");
  const withEffectErrors = decisions.filter((d) => failedEffects(d) > 0);
  console.log(`Decisions with failed side effects: ${withEffectErrors.length}  (shadow decisions execute nothing, so this stays 0 until live)`);
  for (const d of withEffectErrors) console.log(`  ${label(byId.get(d.ghlAccountId))}  ${d.trigger}`);
  const jr = await db.jobRun.findUnique({ where: { job: "dunning_shadow" }, select: { lastStartAt: true, lastOkAt: true, lastError: true, lastSummary: true } });
  console.log(`dunning_shadow hook job: ${jr ? `last ok ${iso(jr.lastOkAt)}, last error: ${jr.lastError ?? "none"}, summary ${JSON.stringify(jr.lastSummary)}` : "no JobRun row"}`);

  const live = intents.filter((i) => i.status !== "skipped_shadow");
  const stuck = live.filter((i) => intentIsStuck(i, now));
  console.log(`\nIntents in period: ${intents.length} (skipped_shadow ${intents.length - live.length}, non-shadow ${live.length}); failed/stuck non-shadow: ${stuck.length}`);
  for (const i of stuck) console.log(`  ${label(byId.get(i.ghlAccountId))}  ${i.pipeline}/${i.kind} ${i.status} attempts=${i.attempts} since ${iso(i.createdAt)} ${i.lastError ?? ""}`);

  let unknown = 0;
  const badStages: string[] = [];
  for (const e of stageEvents) {
    const p = parseStage(e.payload);
    if (e.source === "stage_change_unmapped" || !p) {
      unknown++;
      badStages.push(`  ${iso(e.receivedAt)} ${maskId(e.externalId)} ${p ? `${p.pipeline} -> "${p.stage}"` : "(unparseable payload)"} [unmapped]`);
      continue;
    }
    const v = classifyStageName(p.pipeline, p.stage);
    if (v === "unknown") { unknown++; badStages.push(`  ${iso(e.receivedAt)} ${maskId(e.externalId)} ${p.pipeline} -> "${p.stage}" [unknown]`); }
  }
  console.log(`\nstage_change events: ${stageEvents.length}; unknown stage names: ${unknown}`);
  for (const l of badStages.slice(0, 40)) console.log(l);
  if (badStages.length > 40) console.log(`  ... ${badStages.length - 40} more`);

  const errEvents = await db.ghlEvent.findMany({
    where: { receivedAt: { gte: since }, OR: [{ lastError: { not: null } }, { processedAt: null }] },
    orderBy: { receivedAt: "asc" },
    select: { source: true, externalId: true, receivedAt: true, processedAt: true, attempts: true, lastError: true },
  });
  const bad = errEvents.filter((e) => isProcessingError(e) || (!e.processedAt && now.getTime() - e.receivedAt.getTime() > 60 * 60_000));
  console.log(`\nGhlEvents with processing errors or unprocessed >1h: ${bad.length}`);
  for (const e of bad.slice(0, 40)) console.log(`  ${iso(e.receivedAt)} ${pad(e.source, 14)} ${maskId(e.externalId)} ${label(e.externalId ? byContact.get(e.externalId) : undefined, e.externalId)} attempts=${e.attempts} ${e.processedAt ? "" : "UNPROCESSED "}${(e.lastError ?? "").slice(0, 120)}`);
  if (bad.length > 40) console.log(`  ... ${bad.length - 40} more`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
