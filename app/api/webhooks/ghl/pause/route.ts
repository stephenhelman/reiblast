import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import { getWalletBalance, pauseLocation } from "@/lib/ghl/client";
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
  const tags = (body.tags as string[]) || [];

  if (!email) {
    console.log("[Pause webhook] No email, ignoring");
    return NextResponse.json({ received: true });
  }

  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  if (!user || !user.ghlLocationId) {
    console.log("[Pause webhook] No user/locationId for email, ignoring:", email);
    return NextResponse.json({ received: true });
  }

  if (user.status === "suspended") {
    return NextResponse.json({ received: true });
  }

  const locationId = user.ghlLocationId;
  const isBillingPause = tags.includes(MEMBER_TAGS.PAYMENT_FAILED);

  if (isBillingPause) {
    const balance = await getWalletBalance(locationId);
    if (balance >= 0) {
      return NextResponse.json({ action: "none" });
    }
  }

  await pauseLocation(locationId);

  await prisma.user.update({
    where: { id: user.id },
    data: { status: "suspended" },
  });

  return NextResponse.json({ action: "paused" });
}
