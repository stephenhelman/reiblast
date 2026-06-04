import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  moveToStage,
  addTag,
  findSubAccountByName,
  findSubAccountByEmail,
  populateSubAccountCustomValues,
} from "@/lib/ghl";
import { MEMBER_TAGS, ONBOARDING_STAGES } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-reiblast-secret");
  if (!secret || secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email as string) || "";
  const contactId =
    (body.contact_id as string) || (body.contactId as string) || "";
  const name = (body.full_name as string) || "";

  if (!email || !contactId) {
    console.error("[Provision] Missing email or contactId", body);
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: normalizedEmail },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    let locationId = user.ghlLocationId ?? "";

    if (locationId) {
      console.log("[Provision] Location already known:", locationId);
    } else {
      console.log(
        "[Provision] Searching for sub-account for:",
        user.businessName,
      );
      locationId =
        (await findSubAccountByName(user.businessName ?? "")) ??
        (await findSubAccountByEmail(normalizedEmail)) ??
        "";

      if (!locationId) {
        console.error(
          `[Provision] Could not find sub-account for ${user.businessName}`,
        );
        return NextResponse.json(
          { error: `Could not find sub-account for ${user.businessName}` },
          { status: 500 },
        );
      }
    }

    console.log("[Provision] Updating user record:", user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ghlLocationId: locationId,
        status: "active",
        onboardingStage: ONBOARDING_STAGES.ACTIVE,
      },
    });

    console.log(
      "[Provision] Populating sub-account custom values:",
      locationId,
    );
    const street = user.businessAddress || "";
    const city = user.businessCity || "";
    const state = user.businessState || "";
    const zip = user.businessZip || "";
    const fullAddress = [street, city, state, zip].filter(Boolean).join(", ");

    await populateSubAccountCustomValues(locationId, {
      business_name: user.businessName || name,
      business_address: fullAddress,
      business_city: city,
      business_state: state,
      business_zip: zip,
      copyright_year: new Date().getFullYear().toString(),
      service_area: user.targetMarket || "",
      effective_date: new Date().toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" }),
    });

    if (!contactId || contactId.startsWith("test_")) {
      console.log(
        "[Provision] Skipping GHL contact updates — test contactId detected",
      );
    } else {
      console.log(
        "[Provision] Updating HQ contact tags and pipeline:",
        contactId,
      );
      await addTag(contactId, MEMBER_TAGS.ONBOARDING_COMPLETE);
      await addTag(contactId, MEMBER_TAGS.ACTIVE);
      await addTag(contactId, MEMBER_TAGS.A2P_PENDING);
      await moveToStage(contactId, ONBOARDING_STAGES.ACTIVE, name);
    }

    console.log("[Provision] Complete:", locationId);
    return NextResponse.json({
      success: true,
      locationId,
      message: "Sub-account configured successfully",
    });
  } catch (err) {
    console.error(
      `[Provision] Error contactId=${contactId} email=${normalizedEmail}:`,
      err,
    );
    return NextResponse.json(
      {
        error: "Configuration failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
