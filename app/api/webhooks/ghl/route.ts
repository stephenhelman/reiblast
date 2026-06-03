import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHQContact, addTag, moveToStage } from "@/lib/ghl";
import { MEMBER_TAGS, ONBOARDING_STAGES } from "@/lib/constants";

export async function POST(req: NextRequest) {
  console.log("[GHL] Received secret:", req.headers.get("x-reiblast-secret"));
  console.log("[GHL] Expected secret:", process.env.GHL_WEBHOOK_SECRET);
  const incomingSecret = req.headers.get("x-reiblast-secret");
  if (!incomingSecret || incomingSecret !== process.env.GHL_WEBHOOK_SECRET) {
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

  if (!email) {
    console.log("[GHL webhook] No email, skipping");
    return NextResponse.json({ received: true });
  }

  try {
    const user = await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: { name, plan: "core", status: "pending_onboarding" },
      create: {
        email: email.toLowerCase(),
        name,
        plan: "core",
        status: "pending_onboarding",
      },
    });

    const { contactId } = await createHQContact(name, email, phone);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { ghlContactId: contactId, otpCode: otp, otpExpiry },
    });
    console.log(`[GHL webhook] OTP stored for ${email}`);

    await addTag(contactId, MEMBER_TAGS.PAYMENT_RECEIVED);
    await addTag(contactId, MEMBER_TAGS.CORE);
    await moveToStage(contactId, ONBOARDING_STAGES.PAYMENT_RECEIVED, name);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[GHL webhook] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
