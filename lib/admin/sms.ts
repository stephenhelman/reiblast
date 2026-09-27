/**
 * SMS delivery of the admin code to the internal account's GHL contact, via the same HQ Conversations endpoint the tools
 * OTP uses (lib/otp.ts is deliberately not touched or imported). Never touches User.otp*.
 */
const GHL_BASE_URL = "https://services.leadconnectorhq.com";

export async function sendAdminSms(contactId: string, code: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" },
      body: JSON.stringify({ type: "SMS", contactId, message: `Your REIblast admin verification code is ${code}. It expires in 10 minutes.`, status: "delivered" }),
    });
    if (!res.ok) {
      console.error("[admin-sms] send failed:", res.status);
      return { success: false };
    }
    return { success: true };
  } catch (err) {
    console.error("[admin-sms] send threw:", err instanceof Error ? err.message : err);
    return { success: false };
  }
}
