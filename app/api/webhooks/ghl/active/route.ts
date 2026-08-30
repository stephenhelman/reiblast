import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import { unpauseLocation } from "@/lib/ghl/client";
import { removeTag } from "@/lib/ghl";
import { MEMBER_TAGS } from "@/lib/constants";

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
  const contactId = (body.contact_id as string) || (body.contactId as string) || "";

  if (!email) {
    console.log("[Active webhook] No email, ignoring");
    return NextResponse.json({ received: true });
  }

  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.log("[Active webhook] No user for email, ignoring:", email);
    return NextResponse.json({ received: true });
  }

  const hadWarnings = user.warningCount > 0;
  const wasSuspended = user.status === "suspended";

  if (hadWarnings) {
    await prisma.user.update({
      where: { id: user.id },
      data: { warningCount: 0 },
    });
    if (contactId) {
      await removeTag(contactId, MEMBER_TAGS.PAYMENT_FAILED);
    }
  }

  if (wasSuspended && user.ghlLocationId) {
    await unpauseLocation(user.ghlLocationId);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { status: "active" },
  });

  return NextResponse.json({ action: "activated", hadWarnings, wasSuspended });
}
