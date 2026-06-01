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
  ONBOARDING_COMPLETE: "Onboarding Complete",
  SUB_ACCOUNT_PROVISIONED: "Sub-Account Provisioned",
  CREDENTIALS_SENT: "Credentials Sent",
  A2P_SUBMITTED: "A2P Submitted",
  ACTIVE: "Active Member",
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
} as const;
