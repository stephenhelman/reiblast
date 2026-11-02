import type { SetupFeeStatus } from "@prisma/client";
import { SUPPORT_PHONE_DISPLAY } from "@/lib/constants";
import { isSetupFeeCleared } from "@/lib/billing/setupFee";
import { ENDED_STATUSES } from "@/lib/billing/state/sweepRules";

/** User.status values that mean "signed up and not suspended/inactive". Wider than Discord's: a founder may claim before onboarding. */
export const FOUNDER_USER_STATUSES: readonly string[] = ["pending_onboarding", "onboarding_complete", "provisioning", "active"];
/** BillingState values that block a claim. null (not yet seeded) and trial/active pass. */
export const FOUNDER_BLOCKED_BILLING_STATES: readonly string[] = ["payment_failed", "paused", "inactive", "churned"];

export type EligibilityInput = {
  account: { contactId: string; accountType: string; billingState: string | null; setupFeeStatus: SetupFeeStatus | null };
  user: { status: string };
  /** GhlSubscriptionState.status for every row on the account's contact (none = no row = passes; blocked only when all have ended). */
  subscriptionStatuses: readonly string[];
};

export type IneligibleReason = "not_member" | "test_account" | "user_status" | "billing" | "subscription_ended" | "setup_fee";
export type Eligibility = { eligible: true } | { eligible: false; reason: IneligibleReason };

/** First failing rule wins. Pure. */
export function checkEligibility(i: EligibilityInput | null): Eligibility {
  if (!i) return { eligible: false, reason: "not_member" };
  const { account, user } = i;
  if (account.accountType !== "member") return { eligible: false, reason: "not_member" };
  if (account.contactId.startsWith("test_")) return { eligible: false, reason: "test_account" };
  if (!FOUNDER_USER_STATUSES.includes(user.status)) return { eligible: false, reason: "user_status" };
  if (account.billingState && FOUNDER_BLOCKED_BILLING_STATES.includes(account.billingState)) return { eligible: false, reason: "billing" };
  // Old canceled/expired rows are normal next to a live one (re-signups), so only "rows exist and ALL have ended" blocks.
  const ended = (s: string) => (ENDED_STATUSES as readonly string[]).includes(s);
  if (i.subscriptionStatuses.length > 0 && i.subscriptionStatuses.every(ended)) return { eligible: false, reason: "subscription_ended" };
  if (!isSetupFeeCleared(account.setupFeeStatus)) return { eligible: false, reason: "setup_fee" };
  return { eligible: true };
}

/** What to tell a member whose identity is already proven. */
export function ineligibleMessage(reason: IneligibleReason): string {
  switch (reason) {
    case "setup_fee":
      return "Pay your $97 setup invoice first (check your texts/email), then come back.";
    case "billing":
    case "subscription_ended":
      return `Your account needs attention, text us at ${SUPPORT_PHONE_DISPLAY}.`;
    default:
      return `Text us at ${SUPPORT_PHONE_DISPLAY} and we'll sort it out.`;
  }
}

type LoadDb = {
  ghlAccount: { findUnique(args: any): PromiseLike<any> };
  ghlSubscriptionState: { findMany(args: any): PromiseLike<any> };
};

/** Loads what checkEligibility needs. Works on the client or a transaction client. */
export async function loadEligibilityInput(db: LoadDb, ghlAccountId: string): Promise<EligibilityInput | null> {
  const a: { contactId: string; accountType: string; billingState: string | null; setupFeeStatus: SetupFeeStatus | null; user: { status: string } } | null = await db.ghlAccount.findUnique({
    where: { id: ghlAccountId },
    select: { contactId: true, accountType: true, billingState: true, setupFeeStatus: true, user: { select: { status: true } } },
  });
  if (!a) return null;
  const subs: { status: string }[] = await db.ghlSubscriptionState.findMany({ where: { contactId: a.contactId }, select: { status: true } });
  return { account: a, user: a.user, subscriptionStatuses: subs.map((s) => s.status) };
}
