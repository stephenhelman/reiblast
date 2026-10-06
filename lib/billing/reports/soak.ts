import { billingStateForClientsStage, isKnownOnboardingStage } from "../stages";

/**
 * Pure logic behind scripts/billing/soak-report.ts (the shadow-period soak report). No db access here: the script reads rows and hands
 * plain data in, so everything below is testable with synthetic rows.
 */

export type DecisionLite = {
  ghlAccountId: string;
  trigger: string;
  eventKind: string;
  eventAt: Date;
  fromState: string | null;
  toState: string | null;
  fromStrikes: number;
  toStrikes: number;
  pauseReason: string | null;
  sideEffects: unknown;
  intents: unknown;
  reason: string;
  walletBalance: string | null;
};

export const maskId = (s: string | null | undefined): string => (s ? `…${s.slice(-4)}` : "(none)");

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);
export const sideEffectTypes = (d: Pick<DecisionLite, "sideEffects">): string[] => arr(d.sideEffects).map((e) => String(e.type));
export const intentStages = (d: Pick<DecisionLite, "intents">, pipeline: "active_client" | "onboarding"): string[] =>
  arr(d.intents).filter((i) => i.pipeline === pipeline).map((i) => String(i.stage));

// ── 1. event coverage ───────────────────────────────────────────────────────

export const countBy = <T>(xs: T[], key: (x: T) => string): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};

export const transitionKey = (d: Pick<DecisionLite, "fromState" | "toState">): string => `${d.fromState ?? "(unseeded)"} → ${d.toState ?? "(none)"}`;

const REASON_NO_CURE = /balance still negative|not confirmed non-negative/;
const REASON_NOT_RESUMED = /is not resumed by payments/;
const REASON_EXCLUDED = /state excludes action/;

type Check = { key: string; label: string; test: (d: DecisionLite) => boolean };
const strikeUp = (d: DecisionLite) => d.eventKind === "wallet_recharge_failed" && d.toStrikes > d.fromStrikes;

export const COVERAGE_CHECKS: Check[] = [
  { key: "strike", label: "counted wallet strike (balance < 0)", test: strikeUp },
  { key: "uncounted", label: "uncounted wallet failure (balance >= 0)", test: (d) => d.eventKind === "wallet_recharge_failed" && /is not negative, no strike/.test(d.reason) },
  { key: "strike2", label: "2nd strike", test: (d) => strikeUp(d) && d.toStrikes === 2 },
  { key: "strike3", label: "3rd strike -> paused", test: (d) => strikeUp(d) && d.toStrikes >= 3 && d.toState === "paused" },
  { key: "core_failed", label: "core subscription failure", test: (d) => d.eventKind === "core_failed" && !/covered/i.test(d.reason) },
  { key: "expired", label: "expired invoice -> paused", test: (d) => d.eventKind === "invoice_expired" && d.toState === "paused" && d.fromState !== "paused" },
  { key: "cure_pf", label: "cure from payment_failed", test: (d) => d.fromState === "payment_failed" && d.toState === "active" && d.eventKind !== "command" },
  { key: "cure_paused", label: "cure from paused", test: (d) => d.fromState === "paused" && (d.toState === "active" || d.toState === "payment_failed") && d.eventKind !== "command" && sideEffectTypes(d).includes("saas_resume") },
  { key: "no_cure", label: "recharge succeeded, balance still negative (no cure)", test: (d) => d.eventKind === "wallet_recharge_succeeded" && REASON_NO_CURE.test(d.reason) },
  { key: "trial_conv", label: "trial converted", test: (d) => d.eventKind === "core_succeeded" && d.fromState === "trial" && d.toState === "active" },
  { key: "trial_end", label: "trial ended unconverted", test: (d) => d.eventKind === "trial_ended_unconverted" && d.toState === "payment_failed" },
  { key: "churn", label: "subscription canceled -> churned", test: (d) => (d.eventKind === "subscription_canceled" || d.eventKind === "subscription_expired") && d.toState === "churned" && d.fromState !== "churned" },
  { key: "command", label: "manual stage command", test: (d) => d.eventKind === "command" },
  { key: "ob_failed", label: "onboarding member: payment failure", test: (d) => intentStages(d, "onboarding").includes("payment_failed") },
  { key: "ob_paused", label: "onboarding member: pause", test: (d) => intentStages(d, "onboarding").includes("paused") },
  { key: "ob_return", label: "onboarding member: return to progress stage", test: (d) => intentStages(d, "onboarding").some((s) => s !== "payment_failed" && s !== "paused") },
];

export type CoverageRow = { key: string; label: string; count: number; lastAt: Date | null };

/** `handoffs` = number of handoff intents (live or shadow-preview) recorded in the period; it is an intent, not a decision. */
export function coverageChecklist(decisions: DecisionLite[], handoffs: number): CoverageRow[] {
  const rows = COVERAGE_CHECKS.map((c) => {
    const hits = decisions.filter(c.test);
    const lastAt = hits.reduce<Date | null>((m, d) => (!m || d.eventAt > m ? d.eventAt : m), null);
    return { key: c.key, label: c.label, count: hits.length, lastAt };
  });
  rows.push({ key: "handoff", label: "handoff to Clients pipeline", count: handoffs, lastAt: null });
  return rows;
}

// ── 2. engine vs legacy ─────────────────────────────────────────────────────

export type StageMove = { at: Date; pipeline: string; stage: string };
export type Outcome = "flagged" | "paused" | "restored" | "churned";

export type LegacyEvidence = {
  /** Transaction rows with a non-success paymentStatus in the period (legacy dedupes failures into these). */
  failTxns: number;
  /** Current values only: the legacy User row keeps no history. */
  warningCount: number;
  userStatus: string | null;
  moves: StageMove[];
};

/** A stage_change payload's stage → the BillingState it means, tolerant of both key ("payment_failed") and name ("Payment Failed") forms. */
export function billingStageOf(stage: string): string | null {
  const k = stage.trim().toLowerCase().replace(/\s+/g, "_");
  if (k === "active_member") return "active";
  return ["trial", "active", "payment_failed", "paused", "inactive", "churned"].includes(k) ? k : null;
}

/** Outcomes the engine reached for one member (decisions in eventAt order). */
export function engineOutcomes(decisions: DecisionLite[]): Set<Outcome> {
  const out = new Set<Outcome>();
  for (const d of decisions) {
    if (strikeUp(d) || (d.toState === "payment_failed" && d.fromState !== "payment_failed")) out.add("flagged");
    if (d.toState === "paused" && d.fromState !== "paused") out.add("paused");
    if ((d.fromState === "payment_failed" || d.fromState === "paused") && (d.toState === "active" || (d.fromState === "paused" && d.toState === "payment_failed" && sideEffectTypes(d).includes("saas_resume")))) out.add("restored");
    if (d.toState === "churned" && d.fromState !== "churned") out.add("churned");
  }
  return out;
}

/** Outcomes legacy evidence shows. Cards moved in stage_change events are read in time order; a move to active only counts as a restore from payment_failed/paused. */
export function legacyOutcomes(l: LegacyEvidence): Set<Outcome> {
  const out = new Set<Outcome>();
  let prev: string | null = null;
  for (const m of [...l.moves].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const s = billingStageOf(m.stage);
    if (!s) continue;
    if (s === "payment_failed") out.add("flagged");
    if (s === "paused") out.add("paused");
    if (s === "churned") out.add("churned");
    if (s === "active" && (prev === "payment_failed" || prev === "paused")) out.add("restored");
    prev = s;
  }
  const inPeriod = l.failTxns > 0 || l.moves.length > 0; // a status or counter with no in-period evidence may predate the soak
  if (l.warningCount > 0 && inPeriod) out.add("flagged");
  if (l.userStatus === "suspended" && inPeriod) out.add("paused");
  return out;
}

export type IntendedKey = "resume_needs_balance" | "inactive_churned_excluded" | "killswitch_no_auto_resume" | "onboarding_routed";
export const INTENDED_LABELS: Record<IntendedKey, string> = {
  resume_needs_balance: "resume requires post-recharge balance >= 0 (legacy cured on any success)",
  inactive_churned_excluded: "payments never move inactive/churned members (legacy had no such guard)",
  killswitch_no_auto_resume: "manual killswitch pauses are never auto-resumed by payments",
  onboarding_routed: "onboarding members are routed to the onboarding pipeline (legacy only moved Clients cards)",
};

export function intendedDifferences(decisions: DecisionLite[]): Set<IntendedKey> {
  const out = new Set<IntendedKey>();
  for (const d of decisions) {
    if (REASON_NO_CURE.test(d.reason)) out.add("resume_needs_balance");
    if (REASON_EXCLUDED.test(d.reason)) out.add("inactive_churned_excluded");
    if (REASON_NOT_RESUMED.test(d.reason) && /manual_killswitch/.test(d.reason)) out.add("killswitch_no_auto_resume");
    if (intentStages(d, "onboarding").length > 0) out.add("onboarding_routed");
  }
  return out;
}

export type Verdict = "agree" | "engine-only action" | "legacy-only action" | "different outcome";
export type MemberComparison = { verdict: Verdict; engine: Outcome[]; legacy: Outcome[]; intended: IntendedKey[]; line: string };

const fmt = (s: Set<Outcome>) => (s.size ? [...s].sort().join("+") : "none");

export function classifyMember(decisions: DecisionLite[], legacy: LegacyEvidence): MemberComparison {
  const e = engineOutcomes(decisions);
  const l = legacyOutcomes(legacy);
  const intended = [...intendedDifferences(decisions)];
  const same = e.size === l.size && [...e].every((x) => l.has(x));
  const engineFailures = decisions.filter((d) => d.eventKind === "wallet_recharge_failed" || d.eventKind === "core_failed").length;
  const counts = `engine failure decisions ${engineFailures} vs legacy failure rows ${legacy.failTxns}`;
  const verdict: Verdict = same ? "agree" : e.size > 0 && l.size === 0 ? "engine-only action" : l.size > 0 && e.size === 0 ? "legacy-only action" : "different outcome";
  const why = same
    ? e.size ? `both ${fmt(e)}` : "neither acted"
    : `engine ${fmt(e)}, legacy ${fmt(l)}`;
  const legacyNote = `legacy: warningCount ${legacy.warningCount}, status ${legacy.userStatus ?? "?"}, ${legacy.moves.length} card move(s)`;
  const tag = !same && intended.length ? ` [intended difference: ${intended.join(", ")}]` : "";
  return { verdict, engine: [...e], legacy: [...l], intended, line: `${why}; ${counts}; ${legacyNote}${tag}` };
}

/** A member is worth listing if the engine did or saw something notable, or legacy shows in-period evidence. */
export function hasActivity(decisions: DecisionLite[], legacy: LegacyEvidence): boolean {
  const notable = decisions.some(
    (d) =>
      d.fromState !== d.toState || d.fromStrikes !== d.toStrikes || sideEffectTypes(d).length > 0 || arr(d.intents).length > 0 ||
      d.eventKind === "wallet_recharge_failed" || d.eventKind === "core_failed" || d.eventKind === "invoice_expired",
  );
  return notable || legacy.failTxns > 0 || legacy.moves.length > 0;
}

// ── 4. health ───────────────────────────────────────────────────────────────

export type StageVerdict = "known" | "unknown";

/** Whether the stage-changed handler (lib/billing/events/stageChanged.ts) recognizes a stage string: onboarding names; Clients names or lowercase keys (+ legacy "paused_confirm"). */
export function classifyStageName(pipeline: string, stage: string): StageVerdict {
  if (pipeline === "onboarding") return isKnownOnboardingStage(stage) ? "known" : "unknown";
  if (pipeline === "active_client") return stage === "paused_confirm" || billingStateForClientsStage(stage) ? "known" : "unknown";
  return "unknown";
}

/** GhlEvent.lastError also carries benign "ignored: …" and "handoff: …" notes; those are not processing errors. */
export const isProcessingError = (e: { lastError: string | null }): boolean => !!e.lastError && !/^(ignored|handoff):/.test(e.lastError);

/** Decision side effects that failed (live mode only; shadow decisions carry none, so this is a standing zero until cutover). */
export function failedEffects(d: Pick<DecisionLite, "sideEffects">): number {
  return arr(d.sideEffects).filter((e) => (e.error && !e.executedAt && !e.superseded) || e.exhausted).length;
}

export const STUCK_INTENT_MS = 60 * 60_000;
export function intentIsStuck(i: { status: string; attempts: number; createdAt: Date }, now: Date): boolean {
  if (i.status === "skipped_shadow" || i.status === "sent") return false;
  return i.status === "failed" || (i.status === "pending" && now.getTime() - i.createdAt.getTime() > STUCK_INTENT_MS);
}
