// Account/Wallet surface view-model types — read-only. This surface never
// writes to ledger/wallet/subscriptions; the only outbound action is the
// stubbed OPWS "update my subscription" task (see app/tools/account/actions.ts).
//
// vendorCostCents is internal instrumentation and MUST NEVER appear on any
// type in this file or any payload lib/accountData.ts produces.

export interface AccountMeteredFeature {
  featureSlug: string;
  toolName: string;
  unit: string;
  used: number;
  /** null = unlimited (never rendered as a meter card — filtered out upstream). */
  allowance: number;
  periodEnd: string; // ISO
}

// "bundle" retired — bundle membership is derived (see currentBundleSlug on
// AccountData below), never a stored subscription row. Every row here is a
// tool_sub.
export type AccountSubscriptionKind = "tool_sub";
export type AccountSubscriptionStatus = "active" | "past_due" | "canceled";

export interface AccountSubscription {
  id: string;
  kind: AccountSubscriptionKind;
  /** REItools+ / REIscore Pro / etc. */
  displayName: string;
  /** "REIscore — 175 analyses/mo", one line per covered feature. */
  grants: string[];
  status: AccountSubscriptionStatus;
  periodEnd: string; // ISO
}

export type LedgerRowKind = "funding" | "credit-debit" | "allowance-covered";

export interface AccountLedgerRow {
  id: string;
  kind: LedgerRowKind;
  createdAt: string; // ISO
  /** Tool brand slug for funding rows with no tool (credit pack purchase / adjustment). */
  toolBrandSlug: string | null;
  toolName: string | null;
  /** "unitCount unit" for consumption rows. */
  activityLabel: string | null;
  /** Funding reason / adjustment label, human-readable. */
  reasonLabel: string | null;
  refId: string | null;
  featureSlug: string | null;
  outcome: "success" | "fail" | null;
  allowanceCovered: boolean;
  /** Raw ledger creditDelta (signed) — the wallet-moving amount. */
  creditDelta: number;
  /** Balance immediately after this entry, computed from the FULL ledger. */
  balanceAfter: number;
  searchText: string;
}

export interface AccountMember {
  id: string;
  name: string;
  email: string;
  walletBalance: number;
}

export interface AccountData {
  member: AccountMember;
  meteredFeatures: AccountMeteredFeature[];
  subscriptions: AccountSubscription[];
  ledger: AccountLedgerRow[];
  /** Derived (lib/entitlement.ts#getCurrentBundleSlug) — for grouping/labeling the tool_sub lines above ("part of Bundle Pro"), not a stored row. */
  currentBundleSlug: string | null;
}
