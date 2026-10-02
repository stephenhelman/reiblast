import type { BillingState, PauseReason } from "@prisma/client";
import type { OnboardingStageKey } from "../onboardingStages";

export type { BillingState, PauseReason };

/** The account as the engine sees it: shadow-projected (or, later, real) state. `null` state = not yet seeded. */
export type Snapshot = {
  state: BillingState | null;
  /** Wallet-recharge strikes (User.warningCount equivalent). Core failures never add strikes. */
  strikes: number;
  pauseReason: PauseReason | null;
  /** An unpaid core-subscription failure is open (so a wallet success must not clear payment_failed). */
  coreFailureOpen: boolean;
};

export type DunningEvent =
  | { kind: "wallet_recharge_failed"; wallet: "auto" | "manual" }
  | { kind: "wallet_recharge_succeeded"; wallet: "auto" | "manual" }
  | { kind: "core_failed" }
  | { kind: "core_succeeded" }
  | { kind: "trial_auth_succeeded" }
  /** An unpaid core recovery invoice went past due / was voided (invoice webhook, and the nightly sweep as a backstop). */
  | { kind: "invoice_expired"; invoiceId?: string }
  /** Stage-change webhook: a manual pipeline move, or the echo of a move the engine sent. */
  | { kind: "command"; stage: BillingState }
  /** Legacy "paused_confirm" (the removed 15-minute debounce). Still parsed, but decides nothing: the pause is part of the paused decision itself. */
  | { kind: "pause_confirmed" }
  /** Nightly subscription sweep (no ledger event exists for these). */
  | { kind: "subscription_canceled"; duringTrial: boolean }
  | { kind: "subscription_expired" }
  | { kind: "trial_ended_unconverted" }
  | { kind: "subscription_trialing" };

/** A wallet balance the rule can trust: read live, read from a snapshot, or estimated (replay). Money is a decimal string. */
export type BalanceReading = { status: "ok"; value: string; estimated: boolean } | { status: "unknown"; why: string };

export type SubscriptionInfo = { name: string | null; trialEndsAt: Date | null };

export type Context = {
  /** The event's own time (replay) or the current time (shadow/live): what "now < coreCoveredUntil" is evaluated against. */
  now: Date;
  coveredUntil: Date | null;
  walletBalance?: BalanceReading;
  subscription?: SubscriptionInfo | null;
  /**
   * Where the member's card lives: handedOff (GhlAccount.activeClientSince set) → Clients pipeline; otherwise Onboarding, with
   * `onboardingProgress` (the forward-only progress stage name) deciding where a cured card returns. Omitted = handed off
   * (the pre-routing behaviour, used by pure-engine callers that have no account row).
   */
  routing?: { handedOff: boolean; onboardingProgress: string | null };
};

export type SideEffect = { type: "saas_pause" | "saas_resume"; /** true = re-asserting an already-true state (a confirmation) */ idempotent?: boolean };

/** A GHL pipeline move. `stage` equals a BillingState value (docs/ghl-server-contract.md). */
export type Intent = {
  pipeline: "active_client";
  stage: BillingState;
  fields: Record<string, unknown>;
  /** "stage" (default) moves the opportunity; "fields" only refreshes contact fields (stage = the current stage). */
  kind?: "stage" | "fields";
} | {
  /** Members still in onboarding: only payment_failed / paused, and the return to the progress stage after a cure. */
  pipeline: "onboarding";
  stage: OnboardingStageKey;
  fields: Record<string, unknown>;
  kind?: "stage";
};

export type Decision = {
  nextState: BillingState | null;
  pauseReason: PauseReason | null;
  warningCount: number;
  coreFailureOpen: boolean;
  trialOffer: string | null;
  trialEndsAt: Date | null;
  /** trialOffer/trialEndsAt were determined by this decision (otherwise leave the account's values alone). */
  trialChanged: boolean;
  sideEffects: SideEffect[];
  intents: Intent[];
  reason: string;
  /** Nothing changed: same state, strikes, pause reason and open-failure flag, and no side effect or intent. */
  noop: boolean;
};

export const STRIKE_LIMIT = 3;
export const TRIAL_OFFER_RE = /\d+\s*Day Trial/i;
