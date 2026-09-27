/** Read-only GHL subscription list (HQ key) for the nightly sub_sweep. */
export type SubRow = { subscriptionId: string; contactId: string; status: string; name: string | null; trialEndsAt: Date | null; cancelledAt: Date | null; updatedAt: Date | null };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const date = (v: unknown): Date | null => {
  const s = str(v);
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** List-shape record → SubRow. The key is `subscriptionId` (what ledger rows reference), falling back to `_id`. */
export function parseSubRow(r: unknown): SubRow | null {
  if (!isObj(r)) return null;
  const subscriptionId = str(r.subscriptionId) ?? str(r._id);
  const contactId = str(r.contactId);
  const status = str(r.status);
  if (!subscriptionId || !contactId || !status) return null;
  return { subscriptionId, contactId, status, name: str(r.entitySourceName) ?? (isObj(r.entitySource) ? str(r.entitySource.name) : null), trialEndsAt: date(r.trialEndDate), cancelledAt: date(r.cancelledAt) ?? date(r.canceledAt), updatedAt: date(r.updatedAt) };
}

export async function listSubscriptionsPage(offset: number, limit = 100): Promise<SubRow[]> {
  const token = process.env.GHL_HQ_API_KEY;
  const locationId = process.env.GHL_HQ_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_HQ_API_KEY / GHL_HQ_LOCATION_ID not set");
  const res = await fetch(`https://services.leadconnectorhq.com/payments/subscriptions?altId=${encodeURIComponent(locationId)}&altType=location&limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GHL subscription list failed: HTTP ${res.status}`);
  const j = (await res.json()) as { data?: unknown[]; subscriptions?: unknown[] };
  return (j.data ?? j.subscriptions ?? []).map(parseSubRow).filter((x): x is SubRow => !!x);
}
