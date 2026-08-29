import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { populateSubAccountCustomValues } from "@/lib/ghl";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";

export async function POST(req: NextRequest) {
  // 1. Validate secret header
  if (!verifyWebhook(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse JSON body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // 3. Extract from customData
    const customData = body.customData as Record<string, unknown> | undefined;

    const email = (customData?.email as string) || "";
    const domain = (customData?.domain as string) || "";
    const repName = (customData?.repName as string) || "";
    const businessEmail = (customData?.businessEmail as string) || "";
    const businessPhone = (customData?.businessPhone as string) || "";

    // 4. Validate required fields
    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    if (!domain) {
      return NextResponse.json({ error: "domain required" }, { status: 400 });
    }

    console.log("[CustomValues webhook] received:", {
      email,
      domain,
      repName,
      businessEmail,
      businessPhone,
    });

    // 5. Find user by email
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.ghlLocationId) {
      return NextResponse.json(
        {
          error:
            "No sub-account found for this user. Provisioning may not be complete.",
        },
        { status: 400 },
      );
    }

    // 6. Normalize domain
    const cleanDomain = domain
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .toLowerCase();

    // 7. Build custom values object
    const values: Record<string, string> = {
      website_url: `https://${cleanDomain}`,
      terms_link: `https://${cleanDomain}/tc`,
      privacy_policy_link: `https://${cleanDomain}/pp`,
      optin_form_link: `https://${cleanDomain}/optin`,
    };

    if (businessEmail) {
      values.business_email = businessEmail;
    }
    if (businessPhone) {
      values.business_phone = businessPhone;
    }
    if (repName) {
      values.rep_name = repName;
    }

    console.log(
      "[CustomValues webhook] updating values for locationId:",
      user.ghlLocationId,
      values,
    );

    // 8. Push custom values to GHL
    const success = await populateSubAccountCustomValues(
      user.ghlLocationId,
      values,
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update custom values in GHL" },
        { status: 500 },
      );
    }

    // 9. Persist domain info on the user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        websiteUrl: `https://${cleanDomain}`,
        businessEmail: businessEmail || user.businessEmail || "",
        businessPhone: businessPhone || user.businessPhone || "",
      },
    });

    // 10. Success response
    return NextResponse.json({
      success: true,
      locationId: user.ghlLocationId,
      valuesUpdated: Object.keys(values),
      domain: cleanDomain,
    });
  } catch (error) {
    // 11. Catch-all error handler
    console.error("[CustomValues webhook] error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
