import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import type { AddonSlug } from "@/lib/constants";

const slugMap: Record<string, AddonSlug> = {
  "a2p addon": "a2p",
  "a2p": "a2p",
  "acq-bot": "acq-bot",
  "ai acquisitions bot": "acq-bot",
  "dispo-bot": "dispo-bot",
  "ai dispositions bot": "dispo-bot",
  "contracts": "contracts",
  "state contract bundle": "contracts",
  "ask-ari": "ask-ari",
  "ask ari": "ask-ari",
};

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

  const customData = body.customData as Record<string, unknown> | undefined;
  const email = (customData?.email as string) || (body.email as string) || "";
  const product = (customData?.product as string) || "";
  const contactId =
    (customData?.contact_id as string) ||
    (body.contact_id as string) ||
    "";

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  if (!product) {
    return NextResponse.json({ error: "Product required" }, { status: 400 });
  }

  const slug = slugMap[product.toLowerCase().trim()];
  if (!slug) {
    console.log("[Addons webhook] Unknown product received:", product);
    return NextResponse.json(
      { error: `Unknown addon: ${product}` },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return NextResponse.json(
        {
          error:
            "No account found. Member must sign up for REIblast Core before purchasing add-ons.",
        },
        { status: 404 },
      );
    }

    const alreadyOwned = user.addons.includes(slug);
    if (alreadyOwned) {
      console.log("[Addons webhook] Addon already owned:", slug, email);
      return NextResponse.json({ success: true, message: "Already owned" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      addons: { push: slug },
    };

    if (slug === "a2p") {
      updateData.a2pAddonPurchasedAt = new Date();
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    console.log("[Addons webhook] Addon added:", slug, email);

    return NextResponse.json({ success: true, addon: slug, email: user.email });
  } catch (err) {
    console.error("[Addons webhook] Error — email:", email, "product:", product, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
