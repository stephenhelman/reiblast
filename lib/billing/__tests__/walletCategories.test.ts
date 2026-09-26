import { describe, expect, it } from "vitest";
import { parseWalletCategory, WALLET_CATEGORIES } from "../walletCategories";

// SYNTHETIC descriptions modeled on the patterns seen in the agency wallet pull.
const CASES: [string, string][] = [
  ["Outbound SMS: Ref-abcdef123456", "outbound_sms"],
  ["Inbound SMS: Ref-abcdef123456", "inbound_sms"],
  ["Outbound MMS: Ref-abcdef123456", "outbound_mms"],
  ["Inbound MMS: Ref-abcdef123456", "inbound_mms"],
  ["SMS Carrier Fees (3)", "sms_carrier_fee"],
  ["MMS Carrier Fees (1)", "mms_carrier_fee"],
  ["Outbound Call: Ref-abcdef123456", "outbound_call"],
  ["Inbound Call: Ref-abcdef123456", "inbound_call"],
  ["Call Recording Storage Daily charge : RECORDING_STORAGE_2026_08_01_abc123", "call_recording_storage"],
  ["Call Recordings", "call_recordings"],
  ["Monthly charge for Local phone number +15550100000 for Aug 2026", "phone_number_monthly"],
  ["Text to Speech (12)", "text_to_speech"],
  ["A2P Registration (1)", "a2p_registration"],
  ["A2P Fast Track charges", "a2p_fast_track"],
  ["Email ref: AbCdEf123456", "email"],
  ["EmailNotification ref: AbCdEf123456", "email_notification"],
  [
    "Auto-Recharge for Agency - Test Agency of USD 10 was successfully added to the wallet. Please, check the billing page for more details:\n  app.example.test/settings/billing/.",
    "agency_auto_recharge",
  ],
  ["WALLET_SALES_TAX ref: tax_abc123", "wallet_sales_tax"],
  ["askai ref: AbCdEf123456", "ask_ai"],
  ["Ask AI ref: AbCdEf123456", "ask_ai"],
  ["EmailVerification ref: AbCdEf123456-1783717088", "email_verification"],
  ["Email Verification ref: AbCdEf123456", "email_verification"],
  ["domainPurchase ref: AbCdEf123456", "domain_purchase"],
  ["Domain Purchase ref: AbCdEf123456", "domain_purchase"],
  ["CallerID Verification", "caller_id_verification"],
  ["Caller ID Verification", "caller_id_verification"],
  ["Workflow Pro Plan — Free Tier (inbound_webhook)", "workflow_premium"],
  ["Workflow AI Builder (premium_action)", "workflow_premium"],
  ["Premium action: something (workflow)", "workflow_premium"],
  ["Manual Recharge for Agency Wallet", "agency_manual_recharge"],
];

describe("parseWalletCategory", () => {
  it.each(CASES)("%s → %s", (desc, cat) => expect(parseWalletCategory(desc)).toBe(cat));

  it("never confuses Call Recording Storage with Call Recordings", () => {
    expect(parseWalletCategory("Call Recording Storage Daily charge : X")).toBe("call_recording_storage");
    expect(parseWalletCategory("Call Recordings")).toBe("call_recordings");
  });

  it("keeps Email and EmailNotification apart", () => {
    expect(parseWalletCategory("EmailNotification ref: x")).toBe("email_notification");
    expect(parseWalletCategory("Email ref: x")).toBe("email");
  });

  it("keeps EmailVerification out of email, and agency recharges apart from each other", () => {
    expect(parseWalletCategory("EmailVerification ref: x")).toBe("email_verification");
    expect(parseWalletCategory("Email ref: x")).toBe("email");
    expect(parseWalletCategory("Auto-Recharge for Agency - X of USD 10 was successfully added")).toBe("agency_auto_recharge");
    expect(parseWalletCategory("Manual Recharge for Agency Wallet")).toBe("agency_manual_recharge");
  });

  it("does not treat a sub-account manual recharge or unrelated Workflow-ish text as agency/premium", () => {
    expect(parseWalletCategory("Manual Recharge for Location Wallet")).toBe("other");
    expect(parseWalletCategory("Something about a workflow")).toBe("other");
  });

  it("unknown, empty, and missing descriptions are other", () => {
    expect(parseWalletCategory("Something brand new")).toBe("other");
    expect(parseWalletCategory("")).toBe("other");
    expect(parseWalletCategory(null)).toBe("other");
    expect(parseWalletCategory(undefined)).toBe("other");
  });

  it("every returned category is a known one", () => {
    for (const [d] of CASES) expect(WALLET_CATEGORIES).toContain(parseWalletCategory(d));
  });
});
