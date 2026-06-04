import { prisma } from "@/lib/prisma";
import { ONBOARDING_STAGE_IDS } from "@/lib/constants";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";

// Buffer: refresh the token if it expires within 10 minutes
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

/**
 * Returns a valid company-level access token for the platform app.
 * Reads from GhlToken("company"), refreshing via refresh_token if expired.
 * Requires the agency OAuth callback to have run at least once to seed the record.
 */
export async function getCompanyToken(): Promise<string> {
  const record = await prisma.ghlToken.findUnique({ where: { locationId: "company" } });

  if (!record) {
    throw new Error("No company token on file — reinstall the agency OAuth app to seed it");
  }

  if (record.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return record.accessToken;
  }

  console.log("[ghl/getCompanyToken] Refreshing company token");

  const res = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GHL_PLATFORM_CLIENT_ID!,
      client_secret: process.env.GHL_PLATFORM_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL company token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 86400) * 1000);

  await prisma.ghlToken.update({
    where: { locationId: "company" },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? record.refreshToken,
      expiresAt,
    },
  });

  return data.access_token;
}

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
    user.ghlLocationTokenExpiresAt.getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS
  ) {
    console.log("[ghl/getLocationToken] Using cached token for location:", locationId);
    return user.ghlLocationToken;
  }

  console.log("[ghl/getLocationToken] Refreshing token for location:", locationId);

  // 2. Get a valid company token (cached + auto-refreshed)
  const companyToken = await getCompanyToken();

  // 3. Exchange company token for a location-scoped token
  const locationTokenRes = await fetch(`${GHL_BASE_URL}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${companyToken}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    body: JSON.stringify({
      companyId: process.env.GHL_AGENCY_ID,
      locationId,
    }),
  });

  if (!locationTokenRes.ok) {
    const err = await locationTokenRes.text();
    throw new Error(`GHL location token exchange failed (${locationTokenRes.status}): ${err}`);
  }

  const locationData = await locationTokenRes.json();
  const token: string = locationData.access_token ?? locationData.token;
  const expiresIn: number = locationData.expires_in ?? 86400;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  if (!token) throw new Error("GHL returned no access_token in location token response");

  // 4. Cache in DB
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
  // Step 1 — Search for existing contact by email
  const searchRes = await fetch(
    `${GHL_BASE_URL}/contacts/?locationId=${process.env.GHL_HQ_LOCATION_ID}&email=${encodeURIComponent(email)}&limit=1`,
    { headers: hqHeaders() },
  );

  const searchText = await searchRes.text();
  const searchData = JSON.parse(searchText);

  console.log("[GHL] Contact search status:", searchRes.status);

  const existingContact = searchData?.contacts?.[0];
  if (existingContact?.id) {
    console.log("[GHL] Found existing contact:", existingContact.id);
    return { contactId: existingContact.id };
  }

  // Step 2 — No existing contact, create new one
  const createRes = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: "POST",
    headers: hqHeaders(),
    body: JSON.stringify({
      locationId: process.env.GHL_HQ_LOCATION_ID,
      name,
      email,
      phone: phone || "",
    }),
  });

  const createText = await createRes.text();
  const createData = JSON.parse(createText);

  console.log("[GHL] createHQContact status:", createRes.status);

  // Handle duplicate gracefully as fallback
  if (createRes.status === 400 && createData?.meta?.contactId) {
    console.log(
      "[GHL] Duplicate contact, using existing:",
      createData.meta.contactId,
    );
    return { contactId: createData.meta.contactId };
  }

  if (!createRes.ok) {
    throw new Error(`Failed to create HQ contact: ${createText}`);
  }

  console.log("[GHL] New contact created:", createData.contact.id);
  return { contactId: createData.contact.id };
}

export async function updateHQContact(
  contactId: string,
  fields: Record<string, string | boolean>,
): Promise<boolean> {
  const customFields = Object.entries(fields).map(([key, value]) => ({
    key,
    field_value: String(value),
  }));

  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}`, {
    method: "PUT",
    headers: hqHeaders(),
    body: JSON.stringify({ customFields }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[GHL] updateHQContact failed:", err);
  }

  return res.ok;
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
  businessAddress?: string,
  businessCity?: string,
  businessState?: string,
  businessZip?: string,
): Promise<{ locationId: string; userId: string; tempPassword: string }> {
  const firstName = name.split(" ")[0];
  const lastName = name.split(" ").slice(1).join(" ") || "User";
  const tempPassword = `REI${Math.random().toString(36).slice(2, 8).toUpperCase()}!`;

  console.log("[GHL] provisionSubAccount called:", {
    name,
    email,
    businessName,
    phone,
    contactId,
    businessAddress,
    businessCity,
    businessState,
    businessZip,
    snapshotId: process.env.GHL_SNAPSHOT_ID,
    agencyId: process.env.GHL_AGENCY_ID,
  });

  try {
    // Step 1 — Create the sub-account (location)
    const locationPayload = {
      name: businessName || `${name} REIblast Account`,
      phone: phone || "",
      companyId: process.env.GHL_AGENCY_ID,
      address: businessAddress || "123 Placeholder St",
      city: businessCity || "Austin",
      state: businessState || "TX",
      country: "US",
      postalCode: businessZip || "78701",
      timezone: "US/Central",
      prospectInfo: { firstName, lastName, email },
      snapshotId: process.env.GHL_SNAPSHOT_ID,
    };

    console.log("[GHL] Creating location...");
    console.log(
      "[GHL] Location payload:",
      JSON.stringify(locationPayload, null, 2),
    );

    const locationRes = await fetch(
      "https://services.leadconnectorhq.com/locations/",
      {
        method: "POST",
        headers: agencyHeaders(),
        body: JSON.stringify({
          ...locationPayload,
          settings: {
            allowDuplicateContact: false,
            allowDuplicateOpportunity: false,
            allowFacebookNameMerge: false,
            disableContactTimezone: false,
          },
        }),
      },
    );

    const locationRawResponse = await locationRes.text();
    console.log("[GHL] Location creation status:", locationRes.status);
    console.log("[GHL] Location creation response:", locationRawResponse);

    if (!locationRes.ok) {
      throw new Error(`Failed to create sub-account: ${locationRawResponse}`);
    }

    const locationData = JSON.parse(locationRawResponse);
    const locationId = locationData.location?.id || locationData.id;

    if (!locationId) {
      throw new Error("No locationId returned from GHL");
    }

    console.log("[GHL] Location created successfully:", locationId);

    // Step 2 — Create the user in the new sub-account
    // Must use role: "user" not "admin" to enforce
    // CSS restrictions set at the agency level
    const userPayload = {
      companyId: process.env.GHL_AGENCY_ID,
      firstName,
      lastName,
      email,
      type: "account",
      role: "user",
      locationIds: [locationId],
    };

    console.log("[GHL] Creating user for location:", locationId);
    console.log("[GHL] User payload:", JSON.stringify(userPayload, null, 2));

    const userRes = await fetch("https://services.leadconnectorhq.com/users/", {
      method: "POST",
      headers: agencyHeaders(),
      body: JSON.stringify({
        ...userPayload,
        password: tempPassword,
        phone: phone || "",
      }),
    });

    const userRawResponse = await userRes.text();
    console.log("[GHL] User creation status:", userRes.status);
    console.log("[GHL] User creation response:", userRawResponse);

    if (!userRes.ok) {
      throw new Error(`Failed to create GHL user: ${userRawResponse}`);
    }

    const userData = JSON.parse(userRawResponse);

    console.log("[GHL] Provisioning complete:", {
      locationId,
      userId: userData.id,
      email,
    });

    return {
      locationId,
      userId: userData.id,
      tempPassword,
    };
  } catch (err) {
    console.error("[GHL] provisionSubAccount failed:", {
      error: err,
      name,
      email,
      businessName,
      snapshotId: process.env.GHL_SNAPSHOT_ID,
      agencyId: process.env.GHL_AGENCY_ID,
    });
    throw err;
  }
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

export async function sendOTPEmail(
  contactId: string,
  email: string,
  otp: string,
  name: string,
): Promise<boolean> {
  const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: "POST",
    headers: hqHeaders(),
    body: JSON.stringify({
      type: "Email",
      contactId,
      emailTo: email,
      emailFrom: process.env.GHL_FROM_EMAIL,
      subject: "Your REIblast verification code",
      html: `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#ffffff;padding:32px;">
  <div style="text-align:center;margin-bottom:24px;">
    <img src="https://reiblast.app/full-lockup.png" alt="REIblast" height="32"/>
  </div>
  <h2 style="color:#0A0A0A;margin-bottom:8px;">Verify your account</h2>
  <p style="color:#444;margin-bottom:24px;">
    Hey ${name}, enter this code to complete your REIblast account setup:
  </p>
  <div style="background:#0A0A0A;color:#F5C842;font-size:40px;font-weight:bold;text-align:center;padding:28px;border-radius:12px;letter-spacing:10px;margin-bottom:24px;">
    ${otp}
  </div>
  <p style="color:#888;font-size:13px;text-align:center;">
    This code expires in 10 minutes.
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="https://reiblast.app/onboarding"
       style="background:#F5C842;color:#000000;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;">
      Complete My Setup →
    </a>
  </div>
  <p style="color:#ccc;font-size:11px;text-align:center;">
    If you didn't purchase REIblast, ignore this email.
  </p>
</div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[GHL] sendOTPEmail failed:", res.status, err);
  } else {
    console.log("[GHL] OTP email sent to:", email);
  }

  return res.ok;
}

export async function findSubAccountByName(businessName: string): Promise<string | null> {
  if (!businessName) return null
  const res = await fetch(
    `${GHL_BASE_URL}/locations/search?companyId=${process.env.GHL_AGENCY_ID}&limit=100`,
    { headers: agencyHeaders() },
  )
  if (!res.ok) {
    const err = await res.text()
    console.error('[GHL] findSubAccountByName failed:', res.status, err)
    return null
  }
  const data = JSON.parse(await res.text())
  const locations: Array<{ id: string; name?: string }> = data.locations || []
  const match = locations.find(
    (loc) => loc.name?.toLowerCase().trim() === businessName.toLowerCase().trim(),
  )
  if (match) {
    console.log('[GHL] Found sub-account by name:', match.id)
    return match.id
  }
  console.log('[GHL] No sub-account found for name:', businessName)
  return null
}

export async function findSubAccountByEmail(email: string): Promise<string | null> {
  if (!email) return null
  const res = await fetch(
    `${GHL_BASE_URL}/locations/search?email=${encodeURIComponent(email)}&companyId=${process.env.GHL_COMPANY_ID}`,
    { headers: agencyHeaders() },
  )
  if (!res.ok) {
    console.error('[GHL] findSubAccountByEmail failed:', res.status, await res.text())
    return null
  }
  const data = await res.json()
  return data?.locations?.[0]?.id ?? null
}

export async function updateSubAccountProfile(
  locationId: string,
  profile: {
    name: string
    address: string
    city: string
    state: string
    zip: string
    email: string
    phone: string
    authorizedRepFirstName: string
    authorizedRepLastName: string
  },
): Promise<void> {
  const res = await fetch(`${GHL_BASE_URL}/locations/${locationId}`, {
    method: "PUT",
    headers: agencyHeaders(),
    body: JSON.stringify({
      name: profile.name,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      state: profile.state,
      postalCode: profile.zip,
      country: "US",
      timezone: "US/Central",
      prospectInfo: {
        firstName: profile.authorizedRepFirstName,
        lastName: profile.authorizedRepLastName,
        email: profile.email,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error("[GHL] updateSubAccountProfile failed:", res.status, err)
  } else {
    console.log("[GHL] Sub-account profile updated:", locationId)
  }
}

export type SubAccountCustomValues = {
  business_name: string
  business_address: string
  business_city: string
  business_state: string
  business_zip: string
  copyright_year: string
  service_area: string
  effective_date: string
}

export async function populateSubAccountCustomValues(
  locationId: string,
  values: Partial<SubAccountCustomValues>,
): Promise<void> {
  const token = await getLocationToken(locationId)
  const locationHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  }

  const listRes = await fetch(`${GHL_BASE_URL}/locations/${locationId}/customValues`, {
    headers: locationHeaders,
  })
  if (!listRes.ok) {
    console.error('[GHL] Failed to list custom values for location:', locationId, await listRes.text())
    return
  }
  const listData = await listRes.json()
  const existing: Array<{ id: string; name: string }> = listData?.customValues ?? []

  // Build name→{id, name} lookup using the same normalization GHL uses
  const cvByKey: Record<string, { id: string; name: string }> = {}
  for (const cv of existing) {
    cvByKey[cv.name.toLowerCase().replace(/\s+/g, '_')] = cv
  }

  await Promise.all(
    Object.entries(values).map(([key, value]) => {
      const cv = cvByKey[key]
      if (!cv) {
        console.warn(`[GHL] Custom value "${key}" not found in sub-account — check snapshot`)
        return Promise.resolve()
      }
      return fetch(`${GHL_BASE_URL}/locations/${locationId}/customValues/${cv.id}`, {
        method: 'PUT',
        headers: locationHeaders,
        body: JSON.stringify({ name: cv.name, value }),
      })
    }),
  )
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
