import { BillingClass, BillingState, PauseReason, type PrismaClient } from "@prisma/client";
import { denverDayOf, denverDayStart } from "./reports/denver";

/**
 * Trailing-N-Denver-day activity window start (default 30). Used by scripts/billing/seed-billing-state.ts to classify a
 * legacy paused/expired/canceled/incomplete_expired subscription: did the location have ANY wallet activity in this
 * window? Snapped to a Denver-day boundary (like coreCoveredUntil elsewhere), so the window is deterministic regardless
 * of the time of day the script runs.
 */
export function trailingActivityWindowStart(now: Date, days = 30): Date {
  return denverDayStart(denverDayOf(new Date(now.getTime() - days * 86_400_000)));
}

export type LegacyOutcome = { billingState: BillingState; pauseReason: PauseReason | null; legacyUnreconciled: boolean; label: string };

/**
 * `activity`: true = wallet activity in the trailing window, false = none, null = unknown (no wallet data for this
 * location at all — the caller may fall back to --wallet-dir; with no fallback either, the account is left unseeded
 * and listed, never guessed).
 */
export function classifyLegacySubscription(activity: boolean | null): LegacyOutcome | null {
  if (activity === null) return null;
  return activity
    ? { billingState: BillingState.paused, pauseReason: PauseReason.non_payment, legacyUnreconciled: true, label: "paused/non_payment (recent activity)" }
    : { billingState: BillingState.churned, pauseReason: null, legacyUnreconciled: true, label: "churned (no recent activity)" };
}

/** A subscription as the seed consumes it: the pull-JSON shape, which GhlSubscriptionState rows are mapped into. */
export type SeedSub = {
  contactId?: string;
  status: string;
  /** Pull JSON only. GhlSubscriptionState has no creation time (every row carries the sweep's lastSeenAt). */
  createdAt?: string;
  entitySourceName?: string;
  recurringProduct?: { product?: { name?: string } };
  lineItemDetails?: { name?: string };
  trialEndDate?: string;
};

/** Source of truth in production: GhlSubscriptionState (populated by sub_sweep). */
export async function loadSubscriptionsFromState(db: Pick<PrismaClient, "ghlSubscriptionState">): Promise<SeedSub[]> {
  const rows = await db.ghlSubscriptionState.findMany();
  return rows.map((r) => ({ contactId: r.contactId, status: r.status, entitySourceName: r.name ?? undefined, trialEndDate: r.trialEndsAt?.toISOString() }));
}

/** With no createdAt to rank by, a contact's several subscriptions are ranked by liveness (mirrors sub_sweep: a canceled/expired
 *  sub never counts against a contact that still holds another live one). Lower = preferred. */
const STATUS_RANK: Record<string, number> = { active: 0, trialing: 1, unpaid: 2, paused: 3, expired: 4, canceled: 5, incomplete_expired: 6 };
const rank = (status: string) => STATUS_RANK[status] ?? 7;

/** Newest first by createdAt when every sub has one (pull JSON); otherwise by liveness (GhlSubscriptionState). */
export function orderSubscriptions(subs: SeedSub[]): SeedSub[] {
  const byCreated = subs.every((s) => !!s.createdAt);
  return [...subs].sort((a, b) => (byCreated ? (b.createdAt as string).localeCompare(a.createdAt as string) : rank(a.status) - rank(b.status)));
}

export type RechargeActivity = { accountIds: Set<string>; contactIds: Set<string>; ledgerHasRecharges: boolean };

/** Succeeded wallet recharges (auto + manual) in BillingLedgerEntry since `windowStart` — the activity signal when a location has
 *  no WalletTransaction rows (production: wallet_usage isn't scheduled). `ledgerHasRecharges` says whether the ledger holds ANY
 *  succeeded recharge at all, so an unloaded ledger reads as "unknown", never as "inactive". */
export async function loadRechargeActivity(db: Pick<PrismaClient, "billingLedgerEntry">, windowStart: Date): Promise<RechargeActivity> {
  const rechargeWhere = { classification: { in: [BillingClass.wallet_auto_recharge, BillingClass.wallet_manual_recharge] }, status: "succeeded" };
  const [recent, anyRecharge] = await Promise.all([
    db.billingLedgerEntry.findMany({ where: { ...rechargeWhere, occurredAt: { gte: windowStart } }, select: { ghlAccountId: true, contactId: true } }),
    db.billingLedgerEntry.findFirst({ where: rechargeWhere, select: { id: true } }),
  ]);
  return {
    accountIds: new Set(recent.map((r) => r.ghlAccountId).filter((x): x is string => !!x)),
    contactIds: new Set(recent.map((r) => r.contactId).filter((x): x is string => !!x)),
    ledgerHasRecharges: !!anyRecharge,
  };
}

/**
 * Recent-activity signal for one account, in preference order:
 *   1. WalletTransaction, when the location has any rows at all (true/false by the trailing window);
 *   2. succeeded wallet recharges in BillingLedgerEntry (true if one in the window; false if none) — only if the ledger has recharges at all;
 *   3. the optional --wallet-dir fallback;
 *   else null (unknown — left unseeded and listed).
 */
export function resolveActivity(a: {
  walletHasAny: boolean;
  walletRecent: boolean;
  ledger: RechargeActivity;
  accountId?: string | null;
  contactId: string;
  fallback: () => boolean | null;
}): boolean | null {
  if (a.walletHasAny) return a.walletRecent;
  if (a.ledger.ledgerHasRecharges) return (!!a.accountId && a.ledger.accountIds.has(a.accountId)) || a.ledger.contactIds.has(a.contactId);
  return a.fallback();
}
