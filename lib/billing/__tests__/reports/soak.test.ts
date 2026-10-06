import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyMember, classifyStageName, coverageChecklist, engineOutcomes, failedEffects, hasActivity, intentIsStuck, isProcessingError, legacyOutcomes, maskId, billingStageOf, type DecisionLite, type LegacyEvidence } from "../../reports/soak";

let n = 0;
const dec = (o: Partial<DecisionLite>): DecisionLite => ({
  ghlAccountId: "A", trigger: `t${++n}`, eventKind: "wallet_recharge_failed", eventAt: new Date(`2026-10-0${1 + (n % 8)}T12:00:00Z`), fromState: "active", toState: "active",
  fromStrikes: 0, toStrikes: 0, pauseReason: null, sideEffects: [], intents: [], reason: "", walletBalance: null, ...o,
});
const legacy = (o: Partial<LegacyEvidence> = {}): LegacyEvidence => ({ failTxns: 0, warningCount: 0, userStatus: "active", moves: [], ...o });
const mv = (stage: string, day: number, pipeline = "active_client") => ({ at: new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`), pipeline, stage });

const strike1 = dec({ toState: "payment_failed", toStrikes: 1, reason: "strike 1 of 3 (balance -4 < 0) → payment_failed", intents: [{ pipeline: "active_client", stage: "payment_failed" }] });
const strike3 = dec({ fromState: "payment_failed", toState: "paused", fromStrikes: 2, toStrikes: 3, pauseReason: "non_payment", sideEffects: [{ type: "saas_pause" }], reason: "strike 3 of 3 → paused (non_payment), pause location" });

describe("coverage checklist", () => {
  const all: DecisionLite[] = [
    strike1,
    dec({ fromState: "payment_failed", toState: "payment_failed", fromStrikes: 1, toStrikes: 2, reason: "strike 2 of 3" }),
    strike3,
    dec({ reason: "failed auto recharge recorded; balance 5.0 is not negative, no strike" }),
    dec({ eventKind: "core_failed", toState: "payment_failed", reason: "core subscription failed (no strike) → payment_failed" }),
    dec({ eventKind: "invoice_expired", toState: "paused", pauseReason: "expired_invoice", reason: "invoice expired → paused" }),
    dec({ eventKind: "core_succeeded", fromState: "payment_failed", toState: "active", reason: "core subscription paid: payment_failed → active" }),
    dec({ eventKind: "wallet_recharge_succeeded", fromState: "paused", toState: "active", sideEffects: [{ type: "saas_resume" }] }),
    dec({ eventKind: "wallet_recharge_succeeded", fromState: "payment_failed", toState: "payment_failed", reason: "recharge succeeded, balance still negative (-1.2) — stays payment_failed" }),
    dec({ eventKind: "core_succeeded", fromState: "trial", toState: "active" }),
    dec({ eventKind: "trial_ended_unconverted", fromState: "trial", toState: "payment_failed" }),
    dec({ eventKind: "subscription_canceled", toState: "churned" }),
    dec({ eventKind: "command", toState: "paused" }),
    dec({ eventKind: "wallet_recharge_failed", intents: [{ pipeline: "onboarding", stage: "payment_failed" }] }),
    dec({ eventKind: "wallet_recharge_failed", intents: [{ pipeline: "onboarding", stage: "paused" }] }),
    dec({ eventKind: "core_succeeded", intents: [{ pipeline: "onboarding", stage: "sub_account_provisioned" }] }),
  ];
  it("every situation is detected from its own decision, and handoff comes from intents", () => {
    const rows = coverageChecklist(all, 1);
    expect(rows.filter((r) => r.count === 0).map((r) => r.key)).toEqual([]);
  });
  it("an empty period shows everything unseen", () => {
    expect(coverageChecklist([], 0).every((r) => r.count === 0)).toBe(true);
  });
  it("a covered core failure and an unknown-balance failure are not counted as the situations they resemble", () => {
    const rows = coverageChecklist([dec({ eventKind: "core_failed", reason: "covered, ignored" }), dec({ reason: "balance unknown; strike not counted" })], 0);
    const c = (k: string) => rows.find((r) => r.key === k)!.count;
    expect(c("core_failed")).toBe(0);
    expect(c("uncounted")).toBe(0);
  });
  it("2nd strike requires an actual strike increase", () => {
    expect(coverageChecklist([dec({ fromStrikes: 2, toStrikes: 2, reason: "noop" })], 0).find((r) => r.key === "strike2")!.count).toBe(0);
  });
});

describe("outcomes", () => {
  it("engine: strike → flagged; third strike → paused; cure → restored; resume from paused → restored", () => {
    expect([...engineOutcomes([strike1])]).toEqual(["flagged"]);
    expect(engineOutcomes([strike1, strike3]).has("paused")).toBe(true);
    expect(engineOutcomes([dec({ eventKind: "wallet_recharge_succeeded", fromState: "paused", toState: "active", sideEffects: [{ type: "saas_resume" }] })]).has("restored")).toBe(true);
    expect(engineOutcomes([dec({ eventKind: "core_succeeded", fromState: "trial", toState: "active" })]).size).toBe(0); // trial conversion is not a restore
  });
  it("legacy: moves are read in time order; active only restores from payment_failed/paused", () => {
    expect([...legacyOutcomes(legacy({ moves: [mv("Paused", 3), mv("Active Member", 5)] }))].sort()).toEqual(["paused", "restored"]);
    expect(legacyOutcomes(legacy({ moves: [mv("Trial", 1), mv("Active Member", 5)] })).size).toBe(0);
    expect(legacyOutcomes(legacy({ moves: [mv("Paused", 5), mv("Active Member", 3)] })).has("restored")).toBe(false); // sorted by time: active came first
  });
  it("legacy status/warningCount only count with in-period evidence (they have no history and may predate the soak)", () => {
    expect(legacyOutcomes(legacy({ userStatus: "suspended", warningCount: 3 })).size).toBe(0);
    expect([...legacyOutcomes(legacy({ userStatus: "suspended", warningCount: 3, failTxns: 1 }))].sort()).toEqual(["flagged", "paused"]);
  });
  it("normalises stage names and keys", () => {
    expect(billingStageOf("Active Member")).toBe("active");
    expect(billingStageOf("Payment Failed")).toBe("payment_failed");
    expect(billingStageOf("paused")).toBe("paused");
    expect(billingStageOf("A2P Approved")).toBeNull();
  });
});

describe("classifyMember", () => {
  it("agree: both flagged and paused", () => {
    const c = classifyMember([strike1, strike3], legacy({ failTxns: 3, warningCount: 3, userStatus: "suspended", moves: [mv("Paused", 4)] }));
    expect(c.verdict).toBe("agree");
  });
  it("agree: neither acted (failure with balance >= 0)", () => {
    expect(classifyMember([dec({ reason: "balance 5 is not negative, no strike" })], legacy({ failTxns: 1 })).verdict).toBe("agree");
  });
  it("engine-only action: engine struck, legacy shows nothing", () => {
    const c = classifyMember([strike1], legacy({ failTxns: 0 }));
    expect(c.verdict).toBe("engine-only action");
    expect(c.line).toContain("engine flagged, legacy none");
  });
  it("legacy-only action: card moved to Paused with no engine action", () => {
    expect(classifyMember([dec({ reason: "no strike" })], legacy({ moves: [mv("Paused", 4)] })).verdict).toBe("legacy-only action");
  });
  it("different outcome: engine paused, legacy only flagged", () => {
    const c = classifyMember([strike1, strike3], legacy({ failTxns: 2, warningCount: 2 }));
    expect(c.verdict).toBe("different outcome");
  });
  it("tags intended differences: recharge success without a cure while legacy restored", () => {
    const noCure = dec({ eventKind: "wallet_recharge_succeeded", fromState: "paused", toState: "paused", reason: "wallet recharge succeeded: strikes reset; recharge succeeded, balance still negative (-2.0) — stays paused (non_payment)" });
    const c = classifyMember([strike1, strike3, noCure], legacy({ failTxns: 3, moves: [mv("Paused", 4), mv("Active Member", 6)] }));
    expect(c.verdict).toBe("different outcome");
    expect(c.intended).toEqual(["resume_needs_balance"]);
    expect(c.line).toContain("intended difference");
  });
  it("tags the other intended differences", () => {
    const excl = classifyMember([dec({ eventKind: "wallet_recharge_failed", fromState: "churned", toState: "churned", reason: "state excludes action (churned)" })], legacy({ moves: [mv("Paused", 4)] }));
    expect(excl.intended).toEqual(["inactive_churned_excluded"]);
    const kill = classifyMember([dec({ eventKind: "core_succeeded", fromState: "paused", toState: "paused", reason: "core subscription paid; paused (manual_killswitch) is not resumed by payments" })], legacy());
    expect(kill.intended).toEqual(["killswitch_no_auto_resume"]);
    const ob = classifyMember([dec({ intents: [{ pipeline: "onboarding", stage: "paused" }], toState: "paused", fromState: "active" })], legacy());
    expect(ob.intended).toEqual(["onboarding_routed"]);
  });
  it("hasActivity: successful no-op payments are not activity; failures and legacy evidence are", () => {
    expect(hasActivity([dec({ eventKind: "core_succeeded", reason: "already active" })], legacy())).toBe(false);
    expect(hasActivity([dec({ eventKind: "wallet_recharge_failed", reason: "no strike" })], legacy())).toBe(true);
    expect(hasActivity([], legacy({ moves: [mv("Paused", 2)] }))).toBe(true);
    expect(hasActivity([], legacy({ userStatus: "suspended" }))).toBe(false);
  });
});

describe("health helpers", () => {
  it("stage names: onboarding known/unknown; Clients keys and names known, others unknown", () => {
    expect(classifyStageName("onboarding", "A2P Approved")).toBe("known");
    expect(classifyStageName("onboarding", "Mystery")).toBe("unknown");
    expect(classifyStageName("active_client", "paused")).toBe("known");
    expect(classifyStageName("active_client", "paused_confirm")).toBe("known");
    expect(classifyStageName("active_client", "Paused")).toBe("known");
    expect(classifyStageName("active_client", "paused ")).toBe("unknown");
    expect(classifyStageName("active_client", "Nope")).toBe("unknown");
    expect(classifyStageName("other", "paused")).toBe("unknown");
  });
  it("benign ignored/handoff notes are not processing errors", () => {
    expect(isProcessingError({ lastError: null })).toBe(false);
    expect(isProcessingError({ lastError: "ignored: duplicate delivery within 60 s" })).toBe(false);
    expect(isProcessingError({ lastError: "handoff: null billingState" })).toBe(false);
    expect(isProcessingError({ lastError: "connect ETIMEDOUT" })).toBe(true);
  });
  it("failed side effects: errors not later executed/superseded, or exhausted", () => {
    expect(failedEffects({ sideEffects: [{ type: "saas_pause", error: "x", attempts: 1 }] })).toBe(1);
    expect(failedEffects({ sideEffects: [{ type: "saas_pause", error: "x", superseded: true }] })).toBe(0);
    expect(failedEffects({ sideEffects: [{ type: "saas_pause", executedAt: "t" }] })).toBe(0);
    expect(failedEffects({ sideEffects: [{ type: "saas_pause", exhausted: true }] })).toBe(1);
    expect(failedEffects({ sideEffects: [] })).toBe(0);
  });
  it("stuck intents: failed, or pending over an hour; never shadow/sent", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const old = new Date("2026-10-06T10:00:00Z");
    expect(intentIsStuck({ status: "failed", attempts: 1, createdAt: now }, now)).toBe(true);
    expect(intentIsStuck({ status: "pending", attempts: 0, createdAt: old }, now)).toBe(true);
    expect(intentIsStuck({ status: "pending", attempts: 0, createdAt: now }, now)).toBe(false);
    expect(intentIsStuck({ status: "skipped_shadow", attempts: 0, createdAt: old }, now)).toBe(false);
    expect(intentIsStuck({ status: "sent", attempts: 1, createdAt: old }, now)).toBe(false);
  });
  it("masks to the last 4", () => {
    expect(maskId("abcdEFGH1234")).toBe("…1234");
    expect(maskId(null)).toBe("(none)");
  });
});

describe("soak-report.ts is read-only", () => {
  const src = readFileSync(path.resolve(__dirname, "../../../../scripts/billing/soak-report.ts"), "utf8");
  it("calls no Prisma write method and no raw execute", () => {
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe)\s*\(/);
  });
  it("uses the shared guarded connect() and rejects --apply", () => {
    expect(src).toMatch(/import \{[^}]*connect[^}]*\} from "\.\/_cli"/);
    expect(src).toMatch(/--apply/);
    expect(src).not.toMatch(/new PrismaClient/);
  });
});
