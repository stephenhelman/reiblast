import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWhopWebhook, extractWhopEvent } from "@/lib/whop";
import {
  createHQContact,
  addTag,
  removeTag,
  moveToStage,
  suspendSubAccount,
} from "@/lib/ghl";
import { MEMBER_TAGS, ONBOARDING_STAGES } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("webhook-signature") || "";
  const webhookId = req.headers.get("webhook-id") || "";
  const webhookTimestamp = req.headers.get("webhook-timestamp") || "";

  if (!verifyWhopWebhook(rawBody, signature, webhookId, webhookTimestamp)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, email, name, whopMemberId, planId, productId } =
    extractWhopEvent(body);
  console.log(`[Whop] event=${event} email=${email} productId=${productId}`);

  // Guard — only process REIblast GHL product
  if (
    process.env.WHOP_PRODUCT_ID &&
    productId !== process.env.WHOP_PRODUCT_ID
  ) {
    console.log(`[Whop] Skipping event for product: ${productId}`);
    return NextResponse.json({ received: true });
  }

  try {
    if (event === "membership.activated") {
      const user = await prisma.user.upsert({
        where: { email: email.toLowerCase() },
        update: {
          name,
          whopMemberId,
          plan: "core",
          status: "pending_onboarding",
        },
        create: {
          email: email.toLowerCase(),
          name,
          whopMemberId,
          plan: "core",
          status: "pending_onboarding",
        },
      });

      const { contactId } = await createHQContact(name, email);

      await prisma.user.update({
        where: { id: user.id },
        data: { ghlContactId: contactId },
      });

      await addTag(contactId, MEMBER_TAGS.PAYMENT_RECEIVED);
      await addTag(contactId, MEMBER_TAGS.CORE);
      await moveToStage(contactId, ONBOARDING_STAGES.PAYMENT_RECEIVED, name);

      return NextResponse.json({ success: true });
    }

    if (event === "membership.deactivated") {
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ whopMemberId }, { email: email.toLowerCase() }],
        },
      });

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "inactive" },
        });

        if (user.ghlContactId) {
          await removeTag(user.ghlContactId, MEMBER_TAGS.ACTIVE);
          await addTag(user.ghlContactId, MEMBER_TAGS.CHURNED);
        }

        if (user.ghlLocationId) {
          await suspendSubAccount(user.ghlLocationId);
        }
      }

      return NextResponse.json({ success: true });
    }

    console.log(`[Whop webhook] unhandled event: ${event}`);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Whop webhook] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
