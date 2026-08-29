import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import { getWalletBalance } from "@/lib/ghl/client";
import { addTag, removeTag } from "@/lib/ghl";
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
  const customData = body.customData as Record<string, unknown> | undefined;
  const transactionId = (customData?.transaction_id as string) || "";
  const paymentStatus = (customData?.payment_status as string) || "";
  const paymentAmountRaw = (customData?.payment_amount as string) || "";
  const paymentCurrency = (customData?.payment_currency as string) || "usd";

  if (!email) {
    console.log("[Payment Failed webhook] No email, ignoring");
    return NextResponse.json({ received: true });
  }

  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  if (!user || !user.ghlLocationId) {
    console.log("[Payment Failed webhook] No user/locationId for email, ignoring:", email);
    return NextResponse.json({ received: true });
  }

  const locationId = user.ghlLocationId;

  // Success path: reset warningCount and remove the payment_failed tag.
  // Not gated on status === 'suspended' — a suspended user who tops up
  // should still have their warning count cleared for when they're reactivated.
  if (paymentStatus.toLowerCase() === "success") {
    await prisma.user.update({
      where: { id: user.id },
      data: { warningCount: 0 },
    });
    if (contactId) {
      await removeTag(contactId, MEMBER_TAGS.PAYMENT_FAILED);
    }
    return NextResponse.json({ action: "reset" });
  }

  if (user.status === "suspended") {
    return NextResponse.json({ received: true });
  }

  const amountCents = Math.round(parseFloat(paymentAmountRaw) * 100) || 0;
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dedupeKey =
    transactionId ||
    createHash("sha256")
      .update(`${locationId}|${amountCents}|${monthKey}`)
      .digest("hex");

  try {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        ghlLocationId: locationId,
        dedupeKey,
        paymentStatus: paymentStatus || "failed",
        amountCents,
        currency: paymentCurrency,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      console.log("[Payment Failed webhook] Duplicate transaction, ignoring:", dedupeKey);
      return NextResponse.json({ received: true });
    }
    throw err;
  }

  const balance = await getWalletBalance(locationId);
  if (balance >= 0) {
    return NextResponse.json({ action: "none" });
  }

  const wasZero = user.warningCount === 0;
  const newCount = user.warningCount + 1;

  if (contactId) {
    await addTag(contactId, MEMBER_TAGS.PAYMENT_FAILED);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { warningCount: newCount },
  });

  return NextResponse.json({
    action: newCount >= 3 ? "threshold" : "warn",
    warningCount: newCount,
    wasZero,
  });
}
