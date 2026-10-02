import { keyForProgressStage } from "../onboardingStages";
import { isNeg } from "../reports/money";
import { STRIKE_LIMIT, TRIAL_OFFER_RE, type BillingState, type Context, type Decision, type DunningEvent, type Intent, type Snapshot } from "./types";

/**
 * The billing state machine. PURE: no I/O, no clock, no randomness — everything it needs arrives in (snapshot, event, ctx).
 * It only DECIDES; nothing here pauses a location, moves a pipeline stage or writes to GHL (side effects and intents are data).
 *
 * Rules (see docs/dunning-engine.md):
 *  - Wallet recharge failure, balance < 0 → strike; active/trial → payment_failed; strikes 1–2 stay payment_failed; the 3rd → paused
 *    (non_payment). Balance ≥ 0 or unknown → recorded, nothing changes.
 *  - Wallet recharge success → strikes = 0. It only CURES the account (payment_failed → active, or paused/non_payment → resume) when the
 *    post-recharge balance is ≥ 0; otherwise strikes reset but the state stays ("recharge succeeded, balance still negative").
 *    An unpaid core failure keeps payment_failed regardless.
 *  - Core failure → payment_failed, NO strike — unless covered (now < coreCoveredUntil). Expired invoice → paused/expired_invoice
 *    (same coverage protection). Core success → active from trial / payment_failed / paused(expired_invoice|non_payment).
 *  - trial_auth success → trial, only from null/trial. inactive & churned: payments change nothing ("state excludes action").
 *  - saas_pause is part of the decision that pauses: the 3rd strike, an expired invoice, a manual move to Paused, and the deliberate
 *    inactive/churned commands / sweep-driven churn. (Still executed only in live mode.) There is no 15-minute debounce any more;
 *    `pause_confirmed` is parsed but decides nothing.
 *  - Intent routing (routeIntents): a handed-off member (activeClientSince) gets Clients-pipeline intents; a member still in onboarding gets
 *    onboarding intents instead — payment_failed / paused, and on a cure (payment_failed|paused → active) a return to the stage matching
 *    onboardingProgress (never forward, never a side stage). Nothing else is sent for them.
 *  - Subscription events (nightly sweep): canceled/expired → churned (deferred while covered, except a cancel during the trial);
 *    trial ended unconverted → payment_failed (core failure open); newly trialing → trial.
 *  - Commands (manual stage moves) apply from any state; a command whose stage already matches is a confirmation that
 *    re-asserts its side effect idempotently.
 */

const cleanBase = (s: Snapshot): Decision => ({
  nextState: s.state,
  pauseReason: s.pauseReason,
  warningCount: s.strikes,
  coreFailureOpen: s.coreFailureOpen,
  trialOffer: null,
  trialEndsAt: null,
  trialChanged: false,
  sideEffects: [],
  intents: [],
  reason: "",
  noop: true,
});

const noop = (s: Snapshot, reason: string): Decision => ({ ...cleanBase(s), reason });

const intent = (stage: BillingState, d: Pick<Decision, "warningCount" | "pauseReason" | "trialOffer" | "trialEndsAt" | "trialChanged">, extra: Record<string, unknown> = {}): Extract<Intent, { pipeline: "active_client" }> => ({
  pipeline: "active_client",
  stage,
  fields: { warningCount: d.warningCount, pauseReason: d.pauseReason, ...(d.trialChanged ? { trialOffer: d.trialOffer, trialEndsAt: d.trialEndsAt?.toISOString() ?? null } : {}), ...extra },
});

/** Change state (emitting a stage intent only when the stage actually changes). */
function moveTo(s: Snapshot, d: Decision, to: BillingState): Decision {
  const changed = s.state !== to;
  return { ...d, nextState: to, intents: changed ? [...d.intents, intent(to, d)] : d.intents };
}

const covered = (ctx: Context): boolean => !!ctx.coveredUntil && ctx.now.getTime() < ctx.coveredUntil.getTime();
const isNoopResult = (s: Snapshot, d: Decision): boolean =>
  d.nextState === s.state && d.pauseReason === s.pauseReason && d.warningCount === s.strikes && d.coreFailureOpen === s.coreFailureOpen && !d.trialChanged && d.sideEffects.length === 0 && d.intents.length === 0;
const finish = (s: Snapshot, d: Decision): Decision => ({ ...d, noop: isNoopResult(s, d) });

/** Does deciding this event need a wallet balance? (Only the caller reads it, and only when needed.) */
export function needsBalance(s: Snapshot, e: DunningEvent): boolean {
  if (e.kind === "wallet_recharge_failed") return s.state !== "paused" && s.state !== "inactive" && s.state !== "churned";
  // A recharge success only cures an account whose balance is confirmed non-negative, so it needs the post-recharge balance
  // exactly when it could cure: paused for non_payment, or payment_failed with no unpaid core failure holding it there.
  if (e.kind === "wallet_recharge_succeeded") return (s.state === "paused" && s.pauseReason === "non_payment") || (s.state === "payment_failed" && !s.coreFailureOpen);
  return false;
}
/** Does deciding this event need the subscription (trial name / end)? */
export function needsSubscription(s: Snapshot, e: DunningEvent): boolean {
  return e.kind === "trial_auth_succeeded" && (s.state === null || s.state === "trial");
}

export function decide(s: Snapshot, e: DunningEvent, ctx: Context): Decision {
  return routeIntents(s, decideCore(s, e, ctx), ctx);
}

/**
 * Re-target the decision's (Clients-pipeline) intents for a member who has not been handed off yet. Pure; never touches state.
 * Handed-off (or routing omitted) → unchanged.
 */
export function routeIntents(s: Snapshot, d: Decision, ctx: Context): Decision {
  if (!ctx.routing || ctx.routing.handedOff || d.intents.length === 0) return d;
  const leavingBillingSideStage = s.state === "payment_failed" || s.state === "paused";
  const intents: Intent[] = [];
  let note = "";
  for (const i of d.intents) {
    if (i.pipeline !== "active_client" || i.kind === "fields") continue; // contact-field refreshes ride the Clients workflow only
    if (i.stage === "payment_failed" || i.stage === "paused") intents.push({ pipeline: "onboarding", stage: i.stage, fields: i.fields });
    else if ((i.stage === "active" || i.stage === "trial") && leavingBillingSideStage) {
      const key = keyForProgressStage(ctx.routing.onboardingProgress);
      if (key) intents.push({ pipeline: "onboarding", stage: key, fields: i.fields });
      else note = " (onboarding card not moved back: no recorded progress stage)";
    }
  }
  return { ...d, intents, reason: d.reason + note };
}

function decideCore(s: Snapshot, e: DunningEvent, ctx: Context): Decision {
  if (e.kind === "command") return decideCommand(s, e.stage);
  if (e.kind === "pause_confirmed") return decidePauseConfirmed(s);
  if (e.kind === "subscription_canceled" || e.kind === "subscription_expired") return decideSubscriptionEnd(s, e, ctx);
  if (e.kind === "trial_ended_unconverted") return decideTrialEnded(s, ctx);
  const st = s.state;

  // inactive (voluntary) and churned: never struck, never auto-resumed — payments are recorded and change nothing.
  if (st === "inactive" || st === "churned") return noop(s, `state excludes action (${st})`);

  switch (e.kind) {
    case "wallet_recharge_failed": {
      if (st === "paused") return noop(s, `already paused (${s.pauseReason ?? "no reason recorded"}); no strike`);
      const b = ctx.walletBalance;
      if (!b || b.status !== "ok") return noop(s, `balance unknown${b && b.status === "unknown" ? ` (${b.why})` : ""}; strike not counted`);
      const est = b.estimated ? " (estimated)" : "";
      if (!isNeg(b.value)) return noop(s, `failed ${e.wallet} recharge recorded; balance ${b.value}${est} is not negative, no strike`);
      const strikes = s.strikes + 1;
      let d: Decision = { ...cleanBase(s), warningCount: strikes };
      if (strikes >= STRIKE_LIMIT) {
        d = { ...d, pauseReason: "non_payment", sideEffects: [{ type: "saas_pause" }], reason: `strike ${strikes} of ${STRIKE_LIMIT} (balance ${b.value}${est} < 0) → paused (non_payment), pause location` };
        return finish(s, moveTo(s, d, "paused"));
      }
      d = { ...d, reason: `strike ${strikes} of ${STRIKE_LIMIT} (balance ${b.value}${est} < 0) → payment_failed` };
      return finish(s, moveTo(s, d, "payment_failed"));
    }

    case "wallet_recharge_succeeded": {
      // Post-recharge balance: cures only if confirmed >= 0. Unknown counts as "not confirmed" — strikes still reset, state stays.
      const b = ctx.walletBalance;
      const cured = !!b && b.status === "ok" && !isNeg(b.value);
      const est = b && b.status === "ok" && b.estimated ? " (estimated)" : "";
      const notCured = (what: string): string =>
        `wallet recharge succeeded: strikes reset; recharge succeeded, balance ${b && b.status === "ok" ? `still negative (${b.value}${est})` : `unknown${b && b.status === "unknown" ? ` (${b.why})` : ""}, not confirmed non-negative`} — ${what}`;

      if (st === "paused") {
        if (s.pauseReason === "non_payment") {
          if (!cured) return finish(s, { ...cleanBase(s), warningCount: 0, reason: notCured("stays paused (non_payment)") });
          // The account was paused for wallet strikes; a recharge that clears the balance cures it. An open core failure keeps payment_failed.
          const d: Decision = { ...cleanBase(s), warningCount: 0, pauseReason: null, sideEffects: [{ type: "saas_resume" }], reason: `wallet recharge succeeded: strikes reset; balance ${b && b.status === "ok" ? b.value : ""}${est} is not negative; paused (non_payment) → resume` };
          return finish(s, moveTo(s, { ...d, reason: s.coreFailureOpen ? `${d.reason}; core failure still open → payment_failed` : d.reason }, s.coreFailureOpen ? "payment_failed" : "active"));
        }
        return finish(s, { ...cleanBase(s), warningCount: 0, reason: `wallet recharge succeeded: strikes reset; paused (${s.pauseReason ?? "no reason recorded"}) is not resumed by payments` });
      }
      let d: Decision = { ...cleanBase(s), warningCount: 0, reason: s.strikes > 0 ? "wallet recharge succeeded: strikes reset" : "wallet recharge succeeded; nothing to reset" };
      if (st === "payment_failed") {
        if (s.coreFailureOpen) d = { ...d, reason: `${d.reason}; unpaid core failure still open → stays payment_failed` };
        else if (cured) d = moveTo(s, { ...d, reason: `${d.reason}; balance ${b && b.status === "ok" ? b.value : ""}${est} is not negative; payment_failed → active` }, "active");
        else d = { ...d, reason: notCured("stays payment_failed") };
      }
      return finish(s, d);
    }

    case "core_failed": {
      if (covered(ctx)) return noop(s, "covered, ignored (core failure while now < coreCoveredUntil)");
      if (st === "paused") return finish(s, { ...cleanBase(s), coreFailureOpen: true, reason: `core failure recorded; already paused (${s.pauseReason ?? "no reason recorded"})` });
      const d: Decision = { ...cleanBase(s), coreFailureOpen: true, reason: "core subscription failed (no strike) → payment_failed" };
      return finish(s, moveTo(s, d, "payment_failed"));
    }

    case "core_succeeded": {
      const base: Decision = { ...cleanBase(s), coreFailureOpen: false };
      if (st === "paused") {
        if (s.pauseReason === "expired_invoice" || s.pauseReason === "non_payment") {
          return finish(s, moveTo(s, { ...base, warningCount: 0, pauseReason: null, sideEffects: [{ type: "saas_resume" }], reason: `core subscription paid: paused (${s.pauseReason}) → active, resume` }, "active"));
        }
        return finish(s, { ...base, reason: `core subscription paid; paused (${s.pauseReason ?? "no reason recorded"}) is not resumed by payments` });
      }
      if (st === "payment_failed") {
        // A wallet failure (strikes > 0) is a separate open failure: payment_failed stays until a wallet recharge succeeds.
        if (s.strikes > 0) return finish(s, { ...base, reason: "core subscription paid; wallet strikes still open → stays payment_failed" });
        return finish(s, moveTo(s, { ...base, reason: "core subscription paid: payment_failed → active" }, "active"));
      }
      if (st === "trial" || st === null) return finish(s, moveTo(s, { ...base, reason: `core subscription paid: ${st ?? "unseeded"} → active` }, "active"));
      return finish(s, { ...base, reason: "core subscription paid; already active" });
    }

    case "trial_auth_succeeded":
      return trialDecision(s, ctx, "trial_auth succeeded");
    case "subscription_trialing":
      return trialDecision(s, ctx, "subscription trialing");

    case "invoice_expired": {
      if (covered(ctx)) return noop(s, "covered, ignored (expired invoice while now < coreCoveredUntil)");
      if (st === "paused") return finish(s, { ...cleanBase(s), coreFailureOpen: true, reason: `expired invoice recorded; already paused (${s.pauseReason ?? "no reason recorded"})` });
      const d: Decision = { ...cleanBase(s), coreFailureOpen: true, pauseReason: "expired_invoice", sideEffects: [{ type: "saas_pause" }], reason: "invoice expired → paused (expired_invoice), pause location" };
      return finish(s, moveTo(s, d, "paused"));
    }
  }
}

/** null/trial → trial with offer/end from the subscription (shared by trial_auth and a newly-trialing subscription). */
function trialDecision(s: Snapshot, ctx: Context, why: string): Decision {
  const st = s.state;
  if (st === "inactive" || st === "churned") return noop(s, `state excludes action (${st})`);
  if (st !== null && st !== "trial") return noop(s, `${why === "trial_auth succeeded" ? "trial_auth" : "trialing"} ignored (state ${st})`);
  const name = ctx.subscription?.name ?? null;
  const trialOffer = name && TRIAL_OFFER_RE.test(name) ? name : null;
  const d: Decision = {
    ...cleanBase(s),
    trialOffer,
    trialEndsAt: ctx.subscription?.trialEndsAt ?? null,
    trialChanged: true,
    reason: `${why} → trial${trialOffer ? ` (${trialOffer})` : ctx.subscription ? " (subscription name is not a “N Day Trial”, offer left blank)" : " (subscription unavailable, offer unknown)"}`,
  };
  const moved = moveTo(s, d, "trial");
  // trial → trial: no stage move, but the offer / end date may have changed — a fields-only intent keeps the contact fields current.
  return finish(s, st === "trial" ? { ...moved, intents: [{ ...intent("trial", d), kind: "fields" }] } : moved);
}

/** Legacy "paused_confirm" (the removed 15-minute debounce): harmless if still delivered — the pause already rode on the paused decision. */
function decidePauseConfirmed(s: Snapshot): Decision {
  return noop(s, "pause_confirmed ignored: the pause is part of the paused decision (no confirmation step)");
}

/** canceled / expired subscription → churned. Deferred while covered — except a cancel DURING the trial, which churns immediately. */
function decideSubscriptionEnd(s: Snapshot, e: Extract<DunningEvent, { kind: "subscription_canceled" | "subscription_expired" }>, ctx: Context): Decision {
  if (s.state === "churned") return noop(s, "already churned");
  const duringTrial = e.kind === "subscription_canceled" && e.duringTrial;
  if (!duringTrial && covered(ctx)) return noop(s, `churn deferred: covered until ${(ctx.coveredUntil as Date).toISOString().slice(0, 10)} (${e.kind === "subscription_canceled" ? "subscription canceled" : "subscription expired"})`);
  const what = duringTrial ? "trial canceled before it ended" : e.kind === "subscription_canceled" ? "subscription canceled" : "subscription expired";
  const d: Decision = { ...cleanBase(s), pauseReason: null, coreFailureOpen: false, sideEffects: [{ type: "saas_pause" }], reason: `${what} → churned, pause location, billing stopped` };
  return finish(s, moveTo(s, d, "churned"));
}

/** A trial ended (+2 days) with no paid core subscription: a core failure (payment_failed), unless covered. Only from trial. */
function decideTrialEnded(s: Snapshot, ctx: Context): Decision {
  if (s.state !== "trial") return noop(s, `trial ended: account is not in trial (state ${s.state ?? "unseeded"})`);
  if (covered(ctx)) return noop(s, "covered, ignored (trial ended unconverted while now < coreCoveredUntil)");
  const d: Decision = { ...cleanBase(s), coreFailureOpen: true, reason: "trial ended without a paid core subscription → payment_failed (core failure open)" };
  return finish(s, moveTo(s, d, "payment_failed"));
}

function decideCommand(s: Snapshot, stage: BillingState): Decision {
  const same = s.state === stage;
  switch (stage) {
    case "paused": {
      const pauseReason = same ? (s.pauseReason ?? "manual_killswitch") : "manual_killswitch";
      // A manual move to Paused pauses the location in the same decision. An echo of a pause the engine itself decided (state already
      // paused) is a plain confirmation: that decision already carried the saas_pause (and its retries), so nothing is re-sent.
      const d: Decision = { ...cleanBase(s), pauseReason, sideEffects: same ? [] : [{ type: "saas_pause" }], reason: same ? "command paused: already paused — confirmation, no change" : "command paused → paused (manual_killswitch), pause location" };
      return finish(s, moveTo(s, d, "paused"));
    }
    case "inactive": {
      const d: Decision = { ...cleanBase(s), pauseReason: "voluntary", sideEffects: [{ type: "saas_pause", ...(same ? { idempotent: true } : {}) }], reason: same ? "command inactive: already inactive — confirmation, re-asserting saas_pause" : "command inactive → inactive (voluntary), pause location" };
      return finish(s, moveTo(s, d, "inactive"));
    }
    case "churned": {
      const d: Decision = { ...cleanBase(s), pauseReason: null, sideEffects: [{ type: "saas_pause", ...(same ? { idempotent: true } : {}) }], reason: same ? "command churned: already churned — confirmation, re-asserting saas_pause" : "command churned → churned, pause location, billing stopped" };
      return finish(s, moveTo(s, d, "churned"));
    }
    case "active": {
      const wasParked = s.state === "paused" || s.state === "inactive" || s.state === "churned";
      const confirmation = s.state === "active" && s.strikes === 0 && !s.coreFailureOpen;
      const d: Decision = {
        ...cleanBase(s),
        warningCount: 0,
        pauseReason: null,
        coreFailureOpen: false,
        sideEffects: [{ type: "saas_resume", ...(wasParked ? {} : { idempotent: true }) }],
        reason: confirmation ? "command active: already active — confirmation, re-asserting saas_resume" : wasParked ? `command active → active, resume location, strikes reset (was ${s.state})` : "command active → active, strikes reset",
      };
      return finish(s, moveTo(s, d, "active"));
    }
    default:
      return noop(s, `command not supported for stage ${stage}`);
  }
}
