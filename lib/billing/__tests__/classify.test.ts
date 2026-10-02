import { describe, expect, it } from "vitest";
import { classify, CLASSIFIER_VERSION } from "../classify";
import { normalizeTransaction } from "../normalizeTransaction";
import { AUTO_DESC, MANUAL_DESC, listTxn, singleTxn } from "./fixtures";

const c = (o = {}, shape: "list" | "single" = "list") =>
  classify(normalizeTransaction(shape === "list" ? listTxn(o) : singleTxn(o))).classification;

describe("classify", () => {
  it("exports version 2", () => expect(CLASSIFIER_VERSION).toBe(2));

  it("rule 1: test-mode is ignored (even a would-be subscription)", () => {
    expect(c({ liveMode: false, subscriptionId: "sub00000000000000001" })).toBe("ignore");
    expect(c({ liveMode: false, subType: "saas_one_time", description: AUTO_DESC })).toBe("ignore");
  });

  it("rule 2: saas_one_time splits on the auto-recharge description", () => {
    expect(c({ subType: "saas_one_time", entityType: "manual", description: AUTO_DESC })).toBe("wallet_auto_recharge");
    expect(c({ subType: "saas_one_time", entityType: "manual", description: MANUAL_DESC })).toBe("wallet_manual_recharge");
    expect(c({ subType: "saas_one_time", entityType: "manual", description: null })).toBe("wallet_manual_recharge");
  });

  it("rule 2 applies to both response shapes", () => {
    expect(c({ subType: "saas_one_time", description: AUTO_DESC }, "single")).toBe("wallet_auto_recharge");
  });

  it("rule 2 beats subscriptionId and amount", () => {
    expect(c({ subType: "saas_one_time", description: MANUAL_DESC, subscriptionId: "sub00000000000000001", amount: 0 })).toBe("wallet_manual_recharge");
  });

  it("rule 3: $0 is trial_auth — even with a subscriptionId (ordering vs rule 4)", () => {
    expect(c({ amount: 0, subscriptionId: "sub00000000000000001" })).toBe("trial_auth");
    expect(c({ amount: 0 })).toBe("trial_auth");
  });

  it("rule 4: subscriptionId or invoice entity is core_subscription, regardless of amount/status", () => {
    expect(c({ subscriptionId: "sub00000000000000001" })).toBe("core_subscription");
    expect(c({ subscriptionId: "sub00000000000000001", amount: 99.99 })).toBe("core_subscription");
    expect(c({ subscriptionId: "sub00000000000000001", status: "failed" })).toBe("core_subscription");
    expect(c({ entityType: "invoice", subType: "payments_subscription", amount: 57 })).toBe("core_subscription");
    expect(c({ subType: "payments_dashboard", subscriptionId: "sub00000000000000001" })).toBe("core_subscription");
  });

  it("rule 4: subscription source subtypes are core_subscription even with no subscriptionId (failed renewals)", () => {
    expect(c({ subType: "saas_subscription", status: "failed" })).toBe("core_subscription");
    expect(c({ subType: "subscription_view", status: "failed" })).toBe("core_subscription");
    expect(c({ subType: "saas_subscription", status: "failed" }, "single")).toBe("core_subscription");
    expect(c({ subType: "saas_subscription", status: "succeeded" })).toBe("core_subscription");
  });

  it("rule 4 does not override $0 (rule 3) or wallet recharges (rule 2)", () => {
    expect(c({ subType: "saas_subscription", amount: 0 })).toBe("trial_auth");
    expect(c({ subType: "saas_one_time", description: MANUAL_DESC })).toBe("wallet_manual_recharge");
  });

  it("rule 5: failed payment_link SOURCE TYPE without a subscription is failed_signup (any subtype)", () => {
    expect(c({ sourceType: "payment_link", subType: "payments_dashboard", status: "failed" })).toBe("failed_signup");
    expect(c({ sourceType: "payment_link", status: "failed" }, "single")).toBe("failed_signup");
  });

  it("rule 5 needs failed status and no subscription; a payment_link SUBTYPE alone is not enough", () => {
    expect(c({ sourceType: "payment_link", status: "succeeded" })).toBe("unclassified");
    expect(c({ sourceType: "payment_link", status: "failed", subscriptionId: "sub00000000000000001" })).toBe("core_subscription");
    expect(c({ subType: "payment_link", status: "failed" })).toBe("unclassified");
  });

  it("rule 5 (v2): a failed row with NO source subtype and no subscription is failed_signup (e.g. failed form/order signups)", () => {
    expect(c({ sourceType: "form", entityType: "order", status: "failed", amount: 57 })).toBe("failed_signup");
    expect(c({ sourceType: "form", entityType: "order", status: "failed", amount: 57 }, "single")).toBe("failed_signup");
    expect(c({ status: "failed" })).toBe("failed_signup"); // fixture default: manual source, no subtype
  });

  it("rule 5 (v2) does not steal rows that earlier rules own, or rows that need a subtype/failed status to match", () => {
    // failed saas_subscription with no subscriptionId is still a core subscription (rule 4 precedes rule 5)
    expect(c({ subType: "saas_subscription", status: "failed" })).toBe("core_subscription");
    expect(c({ subType: "subscription_view", status: "failed" })).toBe("core_subscription");
    // a subscriptionId, an invoice entity or $0 also beat rule 5
    expect(c({ status: "failed", subscriptionId: "sub00000000000000001" })).toBe("core_subscription");
    expect(c({ status: "failed", entityType: "invoice" })).toBe("core_subscription");
    expect(c({ status: "failed", amount: 0 })).toBe("trial_auth");
    // wallet recharges (rule 2) even when failed
    expect(c({ status: "failed", subType: "saas_one_time", description: AUTO_DESC })).toBe("wallet_auto_recharge");
    // a non-payment_link failed row that HAS a subtype is still unclassified
    expect(c({ status: "failed", subType: "payments_dashboard" })).toBe("unclassified");
    // only failed rows: a succeeded no-subtype, no-subscription row stays unclassified
    expect(c({ status: "succeeded" })).toBe("unclassified");
    expect(c({ status: "pending" })).toBe("unclassified");
  });

  it("rule 6: everything else is unclassified", () => {
    expect(c({ subType: "payments_dashboard" })).toBe("unclassified");
    expect(c({ subType: "payments_dashboard", status: "failed" })).toBe("unclassified");
    expect(c({})).toBe("unclassified"); // succeeded, no subtype, no subscription
  });

  it("refunds do not reclassify (never returns the refund class)", () => {
    expect(c({ subscriptionId: "sub00000000000000001", status: "refunded", amountRefunded: 57 })).toBe("core_subscription");
    expect(c({ subType: "saas_one_time", description: MANUAL_DESC, status: "refunded", amountRefunded: 12 })).toBe("wallet_manual_recharge");
  });

  it("returns a reason", () => {
    expect(classify(normalizeTransaction(listTxn({ amount: 0 }))).reason).toMatch(/0/);
  });
});
