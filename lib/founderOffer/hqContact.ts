const GHL_BASE_URL = "https://services.leadconnectorhq.com";

export type HqContactIdentity = { firstName: string | null; lastName: string | null; email: string | null; phone: string | null };

/** Name, email and phone from the HQ contact. Null on any failure (logs a status code only, never the body or the number). */
export async function fetchHqContactIdentity(contactId: string, timeoutMs = 5_000): Promise<HqContactIdentity | null> {
  try {
    const res = await fetch(`${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`, {
      headers: { Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error("[founder] HQ contact fetch failed:", res.status);
      return null;
    }
    const c = (await res.json().catch(() => null))?.contact;
    if (!c) return null;
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return { firstName: s(c.firstName), lastName: s(c.lastName), email: s(c.email), phone: s(c.phone) };
  } catch {
    console.error("[founder] HQ contact fetch threw");
    return null;
  }
}
