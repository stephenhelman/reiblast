import { prisma } from "@/lib/prisma";
import { updateHQContact } from "@/lib/ghl";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const GHL_BASE_URL = "https://services.leadconnectorhq.com";

export type OtpFlow = "onboarding" | "tools";

function hqHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

export type MintOtpParams = {
  userId: string;
  contactId: string;
  phone: string;
  // Onboarding only — GHL custom field written for support visibility.
  // Not used for the tools flow: the Conversations SMS send already
  // creates a real, visible message in the contact's conversation thread.
  visibilityField?: string;
  flow: OtpFlow;
};

export type MintOtpResult =
  | { success: true }
  | { success: false; reason: "webhook_failed" | "delivery_failed" };

async function deliverViaOnboardingWebhook(
  code: string,
  { contactId, phone }: Omit<MintOtpParams, "userId" | "visibilityField" | "flow">,
): Promise<MintOtpResult> {
  const webhookUrl = process.env.GHL_OTP_WEBHOOK_URL_ONBOARDING;
  if (!webhookUrl) {
    console.error("[otp] No webhook URL configured for flow: onboarding");
    return { success: false, reason: "webhook_failed" };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, code, phone }),
    });
    if (!res.ok) {
      console.error("[otp] Webhook POST failed (onboarding):", res.status, await res.text());
      return { success: false, reason: "webhook_failed" };
    }
  } catch (err) {
    console.error("[otp] Webhook POST threw (onboarding):", err);
    return { success: false, reason: "webhook_failed" };
  }

  return { success: true };
}

async function deliverViaToolsSms(
  code: string,
  { contactId }: Omit<MintOtpParams, "userId" | "phone" | "visibilityField" | "flow">,
): Promise<MintOtpResult> {
  try {
    const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
      method: "POST",
      headers: hqHeaders(),
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message: `Your REIblast tools verification code is ${code}. It expires in 10 minutes.`,
        status: "delivered",
      }),
    });
    if (!res.ok) {
      console.error("[otp] Conversations API send failed (tools):", res.status, await res.text());
      return { success: false, reason: "delivery_failed" };
    }
    const data = await res.json().catch(() => null);
    console.log("[otp] Tools SMS sent:", { conversationId: data?.conversationId, messageId: data?.messageId });
  } catch (err) {
    console.error("[otp] Conversations API send threw (tools):", err);
    return { success: false, reason: "delivery_failed" };
  }

  return { success: true };
}

async function deliverOtp(
  code: string,
  { contactId, phone, visibilityField, flow }: Omit<MintOtpParams, "userId">,
): Promise<MintOtpResult> {
  const result =
    flow === "onboarding"
      ? await deliverViaOnboardingWebhook(code, { contactId, phone })
      : await deliverViaToolsSms(code, { contactId });

  if (!result.success) {
    return result;
  }

  // Onboarding only — best-effort visibility field write. Never blocks delivery.
  // The tools flow skips this: the Conversations API SMS send already puts the
  // code in the contact's conversation thread with timestamp and delivery status.
  if (flow === "onboarding" && visibilityField) {
    try {
      await updateHQContact(contactId, { [visibilityField]: code });
    } catch (err) {
      console.error("[otp] Best-effort visibility field write failed:", err);
    }
  }

  return { success: true };
}

async function markSent(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { otpLastSentAt: new Date() },
  });
}

export async function mintOtp(params: MintOtpParams): Promise<MintOtpResult> {
  const { userId, contactId, phone, visibilityField, flow } = params;

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);

  await prisma.user.update({
    where: { id: userId },
    data: { otpCode: code, otpExpiry, otpAttempts: 0 },
  });

  const result = await deliverOtp(code, { contactId, phone, visibilityField, flow });
  if (result.success) {
    await markSent(userId);
  }
  return result;
}

/**
 * DEV-ONLY stub of the mint step for the admin login path. Same storage
 * shape as mintOtp (otpCode/otpExpiry/otpAttempts/otpLastSentAt) so verifyOtp
 * works completely unchanged — the only thing skipped is deliverOtp, since
 * admin accounts have no ghlContactId/a2pPhone to deliver an SMS to yet.
 * Go-live unstubs this the same way any other delivery channel gets wired up
 * — it is not a second auth model, just the same mint step without a send.
 */
export async function mintOtpDevStub(userId: string): Promise<{ code: string }> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);
  await prisma.user.update({
    where: { id: userId },
    data: { otpCode: code, otpExpiry, otpAttempts: 0, otpLastSentAt: new Date() },
  });
  return { code };
}

export type ResendOtpParams = MintOtpParams;
export type ResendOtpResult = MintOtpResult;

export async function resendOtp(params: ResendOtpParams): Promise<ResendOtpResult> {
  return mintOtp(params);
}

export type RedeliverOtpParams = MintOtpParams;
export type RedeliverOtpResult = MintOtpResult;

/**
 * Re-sends the CURRENT stored code via the flow's delivery path, without
 * minting a new one or touching expiry/attempts. Used when a caller wants
 * to resend a still-live code rather than issue a fresh one.
 */
export async function redeliverOtp(params: RedeliverOtpParams): Promise<RedeliverOtpResult> {
  const { userId, contactId, phone, visibilityField, flow } = params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.otpCode || !user.otpExpiry || user.otpExpiry < new Date()) {
    throw new Error(`redeliverOtp: no live code for user ${userId}`);
  }

  const result = await deliverOtp(user.otpCode, { contactId, phone, visibilityField, flow });
  if (result.success) {
    await markSent(userId);
  }
  return result;
}

export type VerifyOtpParams = {
  userId: string;
  code: string;
  contactId?: string;
  visibilityField?: string;
};

export type VerifyOtpResult =
  | { status: "success" }
  | { status: "expired" }
  | { status: "wrong"; attemptsRemaining: number }
  | { status: "locked_out" };

export async function verifyOtp(params: VerifyOtpParams): Promise<VerifyOtpResult> {
  const { userId, code, contactId, visibilityField } = params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error(`verifyOtp: no user found for id ${userId}`);
  }

  if (!user.otpCode || !user.otpExpiry || user.otpExpiry < new Date()) {
    return { status: "expired" };
  }

  if (user.otpAttempts >= MAX_ATTEMPTS) {
    return { status: "locked_out" };
  }

  if (user.otpCode !== code) {
    const attempts = user.otpAttempts + 1;
    await prisma.user.update({
      where: { id: userId },
      data: { otpAttempts: attempts },
    });
    if (attempts >= MAX_ATTEMPTS) {
      return { status: "locked_out" };
    }
    return { status: "wrong", attemptsRemaining: MAX_ATTEMPTS - attempts };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { otpCode: null, otpExpiry: null, otpAttempts: 0 },
  });

  if (contactId && visibilityField) {
    try {
      await updateHQContact(contactId, { [visibilityField]: "" });
    } catch (err) {
      console.error("[otp] Best-effort visibility field blank failed:", err);
    }
  }

  return { status: "success" };
}
