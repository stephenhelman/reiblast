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
