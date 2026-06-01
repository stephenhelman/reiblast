import { prisma } from "@/lib/prisma";
import { ONBOARDING_STAGE_IDS } from "@/lib/constants";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";

// Buffer: refresh the token if it expires within 10 minutes
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

export async function getLocationToken(locationId: string): Promise<string> {
  // 1. Check cache
  const user = await prisma.user.findFirst({
    where: { ghlLocationId: locationId },
    select: {
      id: true,
      ghlLocationToken: true,
      ghlLocationTokenExpiresAt: true,
    },
  });

  if (
    user?.ghlLocationToken &&
    user.ghlLocationTokenExpiresAt &&
    user.ghlLocationTokenExpiresAt.getTime() - Date.now() >
      TOKEN_REFRESH_BUFFER_MS
  ) {
    console.log(
      "[ghl/getLocationToken] Using cached token for location:",
      locationId,
    );
    return user.ghlLocationToken;
  }

  // 2. Fetch a fresh token
  console.log(
    "[ghl/getLocationToken] Refreshing token for location:",
    locationId,
  );
  const res = await fetch(`${GHL_BASE_URL}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    body: JSON.stringify({
      companyId: process.env.GHL_COMPANY_ID,
      locationId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL location token fetch failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  console.log("[ghl/getLocationToken] Token response:", JSON.stringify(data));

  const token: string = data.access_token ?? data.token;
  const expiresIn: number = data.expires_in ?? 86400; // default 24h if not returned
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  if (!token)
    throw new Error("GHL returned no access_token in location token response");

  // 3. Cache in DB
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { ghlLocationToken: token, ghlLocationTokenExpiresAt: expiresAt },
    });
  }

  return token;
}

function agencyHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

function hqHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

export async function createHQContact(
  name: string,
  email: string,
  phone?: string,
): Promise<{ contactId: string }> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: "POST",
    headers: hqHeaders(),
    body: JSON.stringify({
      locationId: process.env.GHL_HQ_LOCATION_ID,
      name,
      email,
      phone: phone || "",
    }),
  });
  if (!res.ok) throw new Error("Failed to create HQ contact");
  const data = await res.json();
  return { contactId: data.contact.id };
}

export async function updateHQContact(
  contactId: string,
  fields: Record<string, string | boolean>,
): Promise<boolean> {
  const customFields = Object.entries(fields).map(([key, value]) => ({
    key,
    field_value: String(value),
  }))

  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}`, {
    method: 'PUT',
    headers: hqHeaders(),
    body: JSON.stringify({ customFields }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[GHL] updateHQContact failed:', err)
  }

  return res.ok
}

export async function addTag(contactId: string, tag: string): Promise<boolean> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: hqHeaders(),
    body: JSON.stringify({ tags: [tag] }),
  });
  return res.ok;
}

export async function removeTag(
  contactId: string,
  tag: string,
): Promise<boolean> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: hqHeaders(),
    body: JSON.stringify({ tags: [tag] }),
  });
  return res.ok;
}

export async function moveToStage(
  contactId: string,
  stage: string,
  contactName?: string,
): Promise<boolean> {
  const stageId = ONBOARDING_STAGE_IDS[stage];
  console.log("[Stage Id]", stageId);

  if (!stageId) {
    console.error(`[GHL] No stage ID found for stage: ${stage}`);
    return false;
  }

  const searchRes = await fetch(
    `${GHL_BASE_URL}/opportunities/search?location_id=${process.env.GHL_HQ_LOCATION_ID}&pipeline_id=${process.env.GHL_ONBOARDING_PIPELINE_ID}&contact_id=${contactId}`,
    { headers: hqHeaders() },
  );

  const searchData = await searchRes.json();

  const opportunity = searchData?.opportunities?.[0];

  if (opportunity) {
    const updateRes = await fetch(
      `${GHL_BASE_URL}/opportunities/${opportunity.id}`,
      {
        method: "PUT",
        headers: hqHeaders(),
        body: JSON.stringify({
          name: contactName || opportunity.name || stage,
          pipelineStageId: stageId,
        }),
      },
    );
    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("[GHL] moveToStage PUT failed:", err);
    }
    return updateRes.ok;
  } else {
    const createRes = await fetch(`${GHL_BASE_URL}/opportunities/`, {
      method: "POST",
      headers: hqHeaders(),
      body: JSON.stringify({
        pipelineId: process.env.GHL_ONBOARDING_PIPELINE_ID,
        locationId: process.env.GHL_HQ_LOCATION_ID,
        pipelineStageId: stageId,
        name: contactName || stage,
        contactId,
        status: "open",
      }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      console.error("[GHL] moveToStage POST failed:", err);
    }
    return createRes.ok;
  }
}

export async function provisionSubAccount(
  name: string,
  email: string,
  businessName: string,
  phone: string,
  contactId: string,
): Promise<{ locationId: string; userId: string; tempPassword: string }> {
  const firstName = name.split(" ")[0];
  const lastName = name.split(" ").slice(1).join(" ") || "User";
  const tempPassword = `REI${Math.random().toString(36).slice(2, 8).toUpperCase()}!`;

  // Step 1 — Create the sub-account (location)
  const locationRes = await fetch(
    "https://services.leadconnectorhq.com/locations/",
    {
      method: "POST",
      headers: agencyHeaders(),
      body: JSON.stringify({
        companyId: process.env.GHL_AGENCY_ID,
        name: businessName || `${name} REIblast Account`,
        email,
        phone: phone || "",
        address: "123 Placeholder St",
        city: "Austin",
        state: "TX",
        country: "US",
        postalCode: "78701",
        snapshotId: process.env.GHL_SNAPSHOT_ID,
      }),
    },
  );

  if (!locationRes.ok) {
    const err = await locationRes.text();
    throw new Error(`Failed to create sub-account: ${err}`);
  }

  const locationData = await locationRes.json();
  const locationId = locationData.location?.id || locationData.id;

  if (!locationId) {
    throw new Error("No locationId returned from GHL");
  }

  // Step 2 — Create the user in the new sub-account
  // Must use role: "user" not "admin" to enforce
  // CSS restrictions set at the agency level
  const userRes = await fetch("https://services.leadconnectorhq.com/users/", {
    method: "POST",
    headers: agencyHeaders(),
    body: JSON.stringify({
      companyId: process.env.GHL_AGENCY_ID,
      firstName,
      lastName,
      email,
      password: tempPassword,
      phone: phone || "",
      type: "account",
      role: "user",
      locationIds: [locationId],
    }),
  });

  if (!userRes.ok) {
    const err = await userRes.text();
    throw new Error(`Failed to create GHL user: ${err}`);
  }

  const userData = await userRes.json();

  return {
    locationId,
    userId: userData.id,
    tempPassword,
  };
}

export async function getLocationApiKey(locationId: string): Promise<string> {
  const res = await fetch(`${GHL_BASE_URL}/locations/${locationId}`, {
    headers: agencyHeaders(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch location ${locationId}: ${err}`);
  }
  const data = await res.json();
  const apiKey = data?.location?.apiKey ?? data?.apiKey;
  if (!apiKey)
    throw new Error(
      `No apiKey found in GHL response for location ${locationId}`,
    );
  return apiKey;
}

export async function suspendSubAccount(locationId: string): Promise<boolean> {
  const res = await fetch(`${GHL_BASE_URL}/locations/${locationId}`, {
    method: "PUT",
    headers: agencyHeaders(),
    body: JSON.stringify({ suspended: true }),
  });
  return res.ok;
}

export async function populateA2PSite(
  locationId: string,
  businessData: {
    businessName: string;
    businessAddress: string;
    businessCity: string;
    businessState: string;
    businessZip: string;
    businessPhone: string;
    businessEmail: string;
    websiteUrl?: string;
  },
): Promise<boolean> {
  const res = await fetch(
    `${GHL_BASE_URL}/locations/${locationId}/customValues`,
    {
      method: "POST",
      headers: agencyHeaders(),
      body: JSON.stringify({
        name: "A2P Business Info",
        value: JSON.stringify(businessData),
      }),
    },
  );
  return res.ok;
}
