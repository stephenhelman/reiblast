/** Read-only fetch of one full GHL transaction by _id (webhook payloads lack the fields needed to classify). */
export async function fetchTransactionById(transactionId: string): Promise<unknown> {
  const token = process.env.GHL_HQ_API_KEY;
  const locationId = process.env.GHL_HQ_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_HQ_API_KEY / GHL_HQ_LOCATION_ID not set");
  if (!/^[A-Za-z0-9]{10,64}$/.test(transactionId)) throw new Error("invalid transaction id");

  const url = `https://services.leadconnectorhq.com/payments/transactions/${transactionId}?altId=${encodeURIComponent(locationId)}&altType=location`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GHL transaction fetch failed: HTTP ${res.status}`);
  return res.json();
}
