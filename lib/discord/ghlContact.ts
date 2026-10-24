const GHL_BASE_URL = "https://services.leadconnectorhq.com";

/**
 * Last 4 digits of the phone on the HQ GHL contact — the number the verification SMS goes to. Returns null on any failure or if
 * there are fewer than 4 digits. The full number is never returned, stored or logged; failures log a status code only.
 */
export async function fetchContactPhoneLast4(contactId: string): Promise<string | null> {
  try {
    const res = await fetch(`${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`, {
      headers: { Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" },
    });
    if (!res.ok) {
      console.error("[discord] HQ contact fetch failed:", res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    const digits = String(data?.contact?.phone ?? "").replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : null;
  } catch {
    console.error("[discord] HQ contact fetch threw");
    return null;
  }
}
