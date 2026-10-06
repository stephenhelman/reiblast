import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHQContact, addTag } from "@/lib/ghl";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import { MEMBER_TAGS } from "@/lib/constants";
import { ensureGhlAccount } from "@/lib/billing/state/dualWrite";
import { enqueueAndSendOnboardingIntent } from "@/lib/billing/onboardingIntents";

export async function POST(req: NextRequest) {
  if (!verifyWebhook(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email as string) || "";
  const name =
    (body.full_name as string) ||
    `${body.first_name || ""} ${body.last_name || ""}`.trim();
  const phone = (body.phone as string) || "";

  const customData = body.customData as Record<string, unknown> | undefined;
  const product = (customData?.product as string) || "";
  console.log("[GHL webhook] product:", product);

  if (!email) {
    console.log("[GHL webhook] No email, skipping");
    return NextResponse.json({ received: true });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const isNewMember = !existingUser;

    // BUG FIX: an existing member hitting this route again (e.g. a renewal payment) must never have their status
    // reset back to "pending_onboarding" — only plan/name are refreshed for an existing user.
    const user = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: { name, plan: "core" },
        })
      : await prisma.user.create({
          data: { email: email.toLowerCase(), name, plan: "core", status: "pending_onboarding" },
        });

    const { contactId } = await createHQContact(name, email, phone);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { ghlContactId: contactId, otpCode: otp, otpExpiry },
    });
    console.log(`[GHL webhook] OTP stored for ${email}`);
    await ensureGhlAccount(prisma, { userId: user.id, contactId }); // additive dual-write; never throws (swallows + logs)

    await addTag(contactId, MEMBER_TAGS.PAYMENT_RECEIVED);
    await addTag(contactId, MEMBER_TAGS.CORE);
    // No direct moveToStage() here anymore: the new_client intent below (sent when ONBOARDING_INTENTS=live) is now
    // the sole mechanism that creates/moves the New Client card for this route — see docs/oct1-release.md.

    if (isNewMember) {
      const acct = await prisma.ghlAccount.findUnique({ where: { userId: user.id }, select: { id: true, contactId: true } });
      if (acct) await enqueueAndSendOnboardingIntent(prisma, { account: { id: acct.id, contactId: acct.contactId }, stageKey: "new_client" });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[GHL webhook] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
