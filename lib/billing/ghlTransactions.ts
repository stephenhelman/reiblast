import { apiStats } from "./ghlWallet";

/** Read-only fetch of one full GHL transaction by _id (webhook payloads lack the fields needed to classify). */
export async function fetchTransactionById(transactionId: string): Promise<unknown> {
  const token = process.env.GHL_HQ_API_KEY;
  const locationId = process.env.GHL_HQ_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_HQ_API_KEY / GHL_HQ_LOCATION_ID not set");
  if (!/^[A-Za-z0-9]{10,64}$/.test(transactionId)) throw new Error("invalid transaction id");

  const url = `https://services.leadconnectorhq.com/payments/transactions/${transactionId}?altId=${encodeURIComponent(locationId)}&altType=location`;
  apiStats.calls++;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GHL transaction fetch failed: HTTP ${res.status}`);
  return res.json();
}

/** One page of the transaction list (HQ PIT), optionally within a createdAt window. Newest-first is not assumed. */
export async function listTransactionsPage(opts: { offset: number; limit?: number; startAt?: string; endAt?: string }): Promise<{ data: unknown[]; totalCount: number | null }> {
  const token = process.env.GHL_HQ_API_KEY;
  const locationId = process.env.GHL_HQ_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_HQ_API_KEY / GHL_HQ_LOCATION_ID not set");
  const u = new URL("https://services.leadconnectorhq.com/payments/transactions");
  u.searchParams.set("altId", locationId);
  u.searchParams.set("altType", "location");
  u.searchParams.set("limit", String(opts.limit ?? 100));
  u.searchParams.set("offset", String(opts.offset));
  if (opts.startAt) u.searchParams.set("startAt", opts.startAt);
  if (opts.endAt) u.searchParams.set("endAt", opts.endAt);
  apiStats.calls++;
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" } });
  if (!res.ok) throw new Error(`GHL transaction list failed: HTTP ${res.status}`);
  const j = await res.json();
  return { data: Array.isArray(j.data) ? j.data : [], totalCount: typeof j.totalCount === "number" ? j.totalCount : null };
}
