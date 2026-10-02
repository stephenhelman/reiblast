import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  addTag,
  findSubAccountByName,
  findSubAccountByEmail,
  populateSubAccountCustomValues,
  updateSubAccountProfile,
} from "@/lib/ghl";
import { verifyWebhook } from "@/lib/ghl/verifyWebhook";
import { MEMBER_TAGS, ONBOARDING_STAGES } from "@/lib/constants";
import { setGhlAccountLocation } from "@/lib/billing/state/dualWrite";
import { progressRank } from "@/lib/billing/stages";
import { enqueueOnboardingIntent } from "@/lib/billing/onboardingIntents";

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

  const ghlAccount = await prisma.ghlAccount.findUnique({
    where: { userId: user.id },
    select: { id: true, contactId: true, onboardingProgress: true },
  });
  const confirmedRank = progressRank("Onboarding Form Confirmed")!;
  if (ghlAccount && ghlAccount.onboardingProgress && (progressRank(ghlAccount.onboardingProgress) ?? -1) >= confirmedRank) {
    console.log(
      `[Provision] No-op: onboardingProgress=${ghlAccount.onboardingProgress} is already at/past "Onboarding Form Confirmed" for user ${user.id} — not re-provisioning`,
    );
    return NextResponse.json({ success: true, noop: true, reason: "already provisioned past Onboarding Form Confirmed" });
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

    await setGhlAccountLocation(prisma, { userId: user.id, locationId, contactId }); // additive dual-write; never throws (swallows + logs)

    console.log(
      "[Provision] Populating sub-account custom values:",
      locationId,
    );
    const street = user.businessAddress || "";
    const city = user.businessCity || "";
    const state = user.businessState || "";
    const zip = user.businessZip || "";
    const fullAddress = [street, city, state, zip].filter(Boolean).join(", ");

    const customValuesOk = await populateSubAccountCustomValues(locationId, {
      business_name: user.businessName || name,
      business_address: fullAddress,
      business_city: city,
      business_state: state,
      business_zip: zip,
      copyright_year: new Date().getFullYear().toString(),
      service_area: user.targetMarket || "",
      effective_date: new Date().toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" }),
    });
    if (!customValuesOk) {
      console.error("[Provision] Custom-values population failed:", locationId);
      return NextResponse.json(
        { error: "Configuration failed", details: "populateSubAccountCustomValues returned failure" },
        { status: 502 },
      );
    }

    const [firstName, ...rest] = name.trim().split(" ");
    console.log("[Provision] Updating sub-account business profile:", locationId);
    const profileOk = await updateSubAccountProfile(locationId, {
      name: user.businessName || name,
      address: street,
      city,
      state,
      zip,
      email: user.businessEmail || normalizedEmail,
      phone: user.businessPhone || "",
      authorizedRepFirstName: firstName || "",
      authorizedRepLastName: rest.join(" ") || "",
    });
    if (!profileOk) {
      console.error("[Provision] Business profile update failed:", locationId);
      return NextResponse.json(
        { error: "Configuration failed", details: "updateSubAccountProfile returned failure" },
        { status: 502 },
      );
    }

    if (!contactId || contactId.startsWith("test_")) {
      console.log(
        "[Provision] Skipping GHL contact updates — test contactId detected",
      );
    } else {
      console.log(
        "[Provision] Updating HQ contact tags:",
        contactId,
      );
      await addTag(contactId, MEMBER_TAGS.ONBOARDING_COMPLETE);
      await addTag(contactId, MEMBER_TAGS.ACTIVE);
      await addTag(contactId, MEMBER_TAGS.A2P_PENDING);
    }

    // Replaces the old direct moveToStage call: record (and, if ONBOARDING_INTENTS=live, send) a sub_account_provisioned
    // intent via the existing outbox. Only reached on full success above.
    const acct = await prisma.ghlAccount.findUnique({ where: { userId: user.id }, select: { id: true, contactId: true } });
    if (acct) {
      await enqueueOnboardingIntent(prisma, { account: { id: acct.id, contactId: acct.contactId }, stageKey: "sub_account_provisioned" });
    } else {
      console.error("[Provision] No GhlAccount row to enqueue sub_account_provisioned intent for user", user.id);
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
