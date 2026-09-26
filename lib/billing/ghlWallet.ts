/**
 * Read-only GHL agency wallet client. Agency PIT (GHL_AGENCY_API_KEY), Version v3.
 * The ONLY non-GET call allowed is the wallet-transactions list POST (it is a read).
 */
import type { WalletTxRow } from "./usageRollup";

const BASE = "https://services.leadconnectorhq.com";
export const apiStats = { calls: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GhlScopeError extends Error {}

function creds() {
  const token = process.env.GHL_AGENCY_API_KEY;
  const companyId = process.env.GHL_COMPANY_ID;
  if (!token || !companyId) throw new Error("GHL_AGENCY_API_KEY / GHL_COMPANY_ID not set");
  return { token, companyId };
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const { token, companyId } = creds();
  const okPost = method === "POST" && path === `/saas/companies/${companyId}/wallet-transactions`;
  if (method !== "GET" && !okPost) throw new Error(`blocked GHL call: ${method} ${path}`);
  for (let attempt = 0; attempt < 6; attempt++) {
    apiStats.calls++;
    const res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new GhlScopeError(`GHL ${res.status} on ${method} ${path.replace(companyId, "{companyId}")}`);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  throw new Error("GHL 429 retries exhausted");
}

/** One page (max 1000) of wallet transactions in a settlementTime window, optionally for one location. */
export async function walletTransactionsPage(opts: { skip: number; from: string; to: string; locationId?: string; limit?: number }): Promise<WalletTxRow[]> {
  const { companyId } = creds();
  const r = await call("POST", `/saas/companies/${companyId}/wallet-transactions`, {
    skip: opts.skip,
    limit: opts.limit ?? 1000,
    timezone: "UTC",
    filters: { settlementTime: { from: opts.from, to: opts.to }, ...(opts.locationId ? { locationId: opts.locationId } : {}) },
  });
  const t = r.json?.data?.transactions;
  if (r.status >= 300 || !Array.isArray(t)) throw new Error(`wallet-transactions unexpected response: HTTP ${r.status}`);
  return t;
}

export type BalanceResult = { status: "ok" | "unavailable" | "error"; balance: number | null; raw: unknown };

export async function walletBalance(locationId: string): Promise<BalanceResult> {
  const { companyId } = creds();
  const r = await call("GET", `/saas/companies/${companyId}/locations/${locationId}/wallet-balance`);
  if (r.status === 200 && typeof r.json?.data?.balance === "number") return { status: "ok", balance: r.json.data.balance, raw: r.json };
  if (r.status === 404 && r.json?.error === "WALLET_BALANCE_UNAVAILABLE") return { status: "unavailable", balance: null, raw: r.json };
  return { status: "error", balance: null, raw: { httpStatus: r.status, body: r.json } };
}
