const GHL_BASE_URL = "https://services.leadconnectorhq.com";

export class GhlApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`GHL API error on ${endpoint} (${status}): ${body}`);
    this.name = "GhlApiError";
  }
}

function agencyHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
    "Content-Type": "application/json",
    Version: "v3",
  };
}

/**
 * Fetches the wallet balance for a location. Ignores complimentaryCredits —
 * only the real balance determines dunning logic.
 */
export async function getWalletBalance(locationId: string): Promise<number> {
  const companyId = process.env.GHL_COMPANY_ID;
  const endpoint = `/saas/companies/${companyId}/locations/${locationId}/wallet-balance`;

  const res = await fetch(`${GHL_BASE_URL}${endpoint}`, {
    method: "GET",
    headers: agencyHeaders(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new GhlApiError(endpoint, res.status, errText);
  }

  const data = await res.json();
  return data.balance as number;
}

async function setLocationPaused(
  locationId: string,
  paused: boolean,
): Promise<void> {
  const companyId = process.env.GHL_COMPANY_ID;
  const endpoint = `/saas/pause/${locationId}`;

  const res = await fetch(`${GHL_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: agencyHeaders(),
    body: JSON.stringify({ paused, companyId }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new GhlApiError(endpoint, res.status, errText);
  }
}

/**
 * Pauses a location's subscription (billing killswitch).
 */
export async function pauseLocation(locationId: string): Promise<void> {
  return setLocationPaused(locationId, true);
}

/**
 * Resumes a previously-paused location's subscription.
 */
export async function unpauseLocation(locationId: string): Promise<void> {
  return setLocationPaused(locationId, false);
}
