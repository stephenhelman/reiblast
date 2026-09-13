export const PLATFORM_NAME = "REIblast";
export const TAGLINE = "From list to blast — close more deals, faster";
export const CORE_PRICE = 57;
export const PROMO_CODE = "ARISTUDENT";
export const JV_SPLIT_CORE = "50/50";
export const MAO_MULTIPLIER = 0.7;
export const MIN_ASSIGNMENT_FEE = 5000;
export const GHL_APP_URL = "https://app.reiblast.app";
export const TOOLS_URL = "https://tools.reiblast.app";
export const MARKETING_URL = "https://reiblast.app";
export const SUPPORT_EMAIL = "support@reiblast.app";

export const ONBOARDING_STAGES = {
  PAYMENT_RECEIVED: "Payment Received",
  ONBOARDING_FORM_SUBMITTED: "Onboarding Form Submitted",
  ONBOARDING_CONFIRMED: "Onboarding Confirmed",
  SUB_ACCOUNT_PROVISIONED: "Sub-Account Provisioned",
  CREDENTIALS_SENT: "Credentials Sent",
  A2P_SUBMITTED: "A2P Submitted",
  ACTIVE: "Active Member",
  PAUSED: "Paused",
} as const;

export const ONBOARDING_STAGE_IDS: Record<string, string> = {
  [ONBOARDING_STAGES.PAYMENT_RECEIVED]:
    process.env.GHL_STAGE_PAYMENT_RECEIVED || "",
  [ONBOARDING_STAGES.ONBOARDING_FORM_SUBMITTED]:
    process.env.GHL_STAGE_ONBOARDING_FORM_SUBMITTED || "",
  [ONBOARDING_STAGES.ONBOARDING_CONFIRMED]:
    process.env.GHL_STAGE_ONBOARDING_CONFIRMED || "",
  [ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED]:
    process.env.GHL_STAGE_SUB_ACCOUNT_PROVISIONED || "",
  [ONBOARDING_STAGES.CREDENTIALS_SENT]:
    process.env.GHL_STAGE_CREDENTIALS_SENT || "",
  [ONBOARDING_STAGES.A2P_SUBMITTED]: process.env.GHL_STAGE_A2P_SUBMITTED || "",
  [ONBOARDING_STAGES.ACTIVE]: process.env.GHL_STAGE_ACTIVE || "",
  [ONBOARDING_STAGES.PAUSED]: process.env.GHL_STAGE_PAUSED || "",
};

export const MEMBER_TAGS = {
  CORE: "Plan: Core",
  ACTIVE: "Core Member",
  ONBOARDING_COMPLETE: "Onboarding Complete",
  A2P_PENDING: "A2P Pending",
  A2P_SUBMITTED: "A2P Submitted",
  A2P_APPROVED: "A2P Approved",
  PAYMENT_RECEIVED: "Payment Received",
  CHURNED: "Churned",
  PAYMENT_FAILED: "payment_failed",
} as const;

export const KNOWN_ADDONS = [
  'acq-bot',
  'dispo-bot',
  'contracts',
  'ask-ari',
] as const;

export type AddonSlug = typeof KNOWN_ADDONS[number];

// GHL custom field key used for support-visibility OTP display (not the delivery path)
export const ONBOARDING_OTP_VISIBILITY_FIELD = "otp_code";

export const TOOLS_SESSION_COOKIE = "reiblast_tools_session";
export const TOOLS_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// Onboarding-identity cookie (marketing host: onboarding -> /welcome -> /discovery).
// Separate from TOOLS_SESSION_COOKIE — that one gates the tools.* subdomain post-a2p;
// this one just carries {contactId,name,email,phone} across the pre-a2p marketing
// funnel, which is all one host (no domain attribute needed, see lib/onboardingSession.ts).
export const ONBOARDING_COOKIE = "reiblast_onboarding";
export const ONBOARDING_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

// Discovery terminal-action sinks — CONFIG PLACEHOLDERS. Real endpoint values,
// mapping, opp creation, tag writes, and the HQ custom-field write are a
// separate chat; this chat only assembles + stub-fires the two payloads.
export const DISCOVERY_HQ_UPDATE_CONTACT_URL =
  process.env.DISCOVERY_HQ_UPDATE_CONTACT_URL || "https://config-placeholder.invalid/hq/update-contact";
export const DISCOVERY_OPWS_INBOUND_WEBHOOK_URL =
  process.env.DISCOVERY_OPWS_INBOUND_WEBHOOK_URL || "https://config-placeholder.invalid/opws/inbound";
// Account surface "Update my subscription" sink — CONFIG PLACEHOLDER, same
// best-effort/failure-swallowing pattern as the discovery sinks above. No
// in-app cancel/upgrade; this only routes the request to OPWS.
export const ACCOUNT_SUBSCRIPTION_UPDATE_OPWS_URL =
  process.env.ACCOUNT_SUBSCRIPTION_UPDATE_OPWS_URL || "https://config-placeholder.invalid/opws/subscription-update";
export const TOOLS_OTP_SEND_COOLDOWN_MS = 60 * 1000;
