/**
 * Pure: GHL wallet-transaction description → usage category. Patterns are those seen in the August 2026
 * agency wallet pull (member locations, HQ, and agency-level rows). Anything else is "other".
 * Order matters where one pattern is a prefix of another.
 */
export const WALLET_CATEGORIES = [
  "outbound_sms",
  "inbound_sms",
  "outbound_mms",
  "inbound_mms",
  "sms_carrier_fee",
  "mms_carrier_fee",
  "outbound_call",
  "inbound_call",
  "call_recording_storage",
  "call_recordings",
  "phone_number_monthly",
  "text_to_speech",
  "a2p_registration",
  "a2p_fast_track",
  "email",
  "email_notification",
  "email_verification",
  "ask_ai",
  "domain_purchase",
  "caller_id_verification",
  "workflow_premium",
  "agency_auto_recharge",
  "agency_manual_recharge",
  "wallet_sales_tax",
  "other",
] as const;

export type WalletCategory = (typeof WALLET_CATEGORIES)[number];

const PATTERNS: [WalletCategory, RegExp][] = [
  ["outbound_sms", /^Outbound SMS/i],
  ["inbound_sms", /^Inbound SMS/i],
  ["outbound_mms", /^Outbound MMS/i],
  ["inbound_mms", /^Inbound MMS/i],
  ["sms_carrier_fee", /^SMS Carrier Fees?/i],
  ["mms_carrier_fee", /^MMS Carrier Fees?/i],
  ["outbound_call", /^Outbound Call/i],
  ["inbound_call", /^Inbound Call/i],
  ["call_recording_storage", /^Call Recording Storage/i],
  ["call_recordings", /^Call Recordings?\s*$/i],
  ["phone_number_monthly", /^Monthly charge for .*phone number/i],
  ["text_to_speech", /^Text to Speech/i],
  ["a2p_registration", /^A2P Registration/i],
  ["a2p_fast_track", /^A2P Fast Track/i],
  ["email_notification", /^EmailNotification/i],
  ["email_verification", /^Email\s?Verification/i], // before "email"
  ["email", /^Email\b/i],
  ["ask_ai", /^Ask\s?AI\b/i],
  ["domain_purchase", /^Domain\s?Purchase/i],
  ["caller_id_verification", /^Caller\s?ID Verification/i],
  ["workflow_premium", /^Workflow\b|premium (action|workflow)/i],
  // Agency cash paid to GHL (scope _agency), like each other:
  ["agency_auto_recharge", /^Auto-?Recharge for Agency/i],
  ["agency_manual_recharge", /^Manual Recharge for Agency/i],
  ["wallet_sales_tax", /^WALLET_SALES_TAX/i],
];

export function parseWalletCategory(description: string | null | undefined): WalletCategory {
  const d = (description ?? "").trim();
  return PATTERNS.find(([, re]) => re.test(d))?.[0] ?? "other";
}
