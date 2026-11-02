import { describe, expect, it } from "vitest";
import { checkEligibility, ineligibleMessage, type EligibilityInput } from "../eligibility";

const ok = (): EligibilityInput => ({
  account: { contactId: "abc123", accountType: "member", billingState: "active", setupFeeStatus: "PAID" },
  user: { status: "active" },
  subscriptionStatuses: [],
});
const with_ = (f: (i: EligibilityInput) => void) => { const i = ok(); f(i); return checkEligibility(i); };

describe("checkEligibility", () => {
  it("passes a clean member", () => expect(checkEligibility(ok())).toEqual({ eligible: true }));
  it("no account → not_member", () => expect(checkEligibility(null)).toEqual({ eligible: false, reason: "not_member" }));
  it("non-member and test_ contacts fail", () => {
    expect(with_((i) => (i.account.accountType = "internal"))).toEqual({ eligible: false, reason: "not_member" });
    expect(with_((i) => (i.account.contactId = "test_1"))).toEqual({ eligible: false, reason: "test_account" });
  });
  it.each(["pending_onboarding", "onboarding_complete", "provisioning", "active"])("user status %s passes", (s) => {
    expect(with_((i) => (i.user.status = s)).eligible).toBe(true);
  });
  it.each(["suspended", "inactive", ""])("user status %j fails closed", (s) => {
    expect(with_((i) => (i.user.status = s))).toEqual({ eligible: false, reason: "user_status" });
  });
  it.each(["payment_failed", "paused", "inactive", "churned"])("billingState %s fails", (b) => {
    expect(with_((i) => (i.account.billingState = b))).toEqual({ eligible: false, reason: "billing" });
  });
  it.each([null, "trial", "active"])("billingState %s passes", (b) => {
    expect(with_((i) => (i.account.billingState = b)).eligible).toBe(true);
  });
  it.each(["canceled", "expired", "incomplete_expired"])("only ended subscriptions (%s) fail", (s) => {
    expect(with_((i) => (i.subscriptionStatuses = [s]))).toEqual({ eligible: false, reason: "subscription_ended" });
    expect(with_((i) => (i.subscriptionStatuses = ["canceled", s]))).toEqual({ eligible: false, reason: "subscription_ended" });
  });
  it("old ended rows next to a live subscription do not block (re-signup)", () => {
    expect(with_((i) => (i.subscriptionStatuses = ["canceled", "canceled", "trialing"])).eligible).toBe(true);
    expect(with_((i) => (i.subscriptionStatuses = ["expired", "active"])).eligible).toBe(true);
  });
  it("trialing / unpaid subscriptions do not block", () => {
    expect(with_((i) => (i.subscriptionStatuses = ["trialing", "unpaid"])).eligible).toBe(true);
  });
  it.each([["NOT_REQUIRED", true], ["PAID", true], ["PENDING", false], ["UNKNOWN", false], [null, false]] as const)("setupFeeStatus %s → eligible=%s", (s, want) => {
    expect(with_((i) => (i.account.setupFeeStatus = s as any)).eligible).toBe(want);
  });
  it("messages: setup fee, account trouble, other", () => {
    expect(ineligibleMessage("setup_fee")).toContain("$97 setup invoice");
    expect(ineligibleMessage("billing")).toContain("(915) 800-8266");
    expect(ineligibleMessage("billing")).toContain("needs attention");
    expect(ineligibleMessage("not_member")).toContain("we'll sort it out");
  });
});
