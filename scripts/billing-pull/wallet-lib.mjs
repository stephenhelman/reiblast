// READ-ONLY. Only GET, plus POST to /saas/companies/{id}/wallet-transactions. No DB writes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
for (const f of [".env.local", ".env"]) {
  const p = path.join(here, "..", "..", f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
export const TOKEN = process.env.GHL_AGENCY_API_KEY;
export const COMPANY = process.env.GHL_COMPANY_ID;
if (!TOKEN || !COMPANY) throw new Error("missing GHL_AGENCY_API_KEY or GHL_COMPANY_ID");
export const idsEqual = process.env.GHL_COMPANY_ID === process.env.GHL_AGENCY_ID;
const BASE = "https://services.leadconnectorhq.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stats = { calls: 0 };
export async function call(method, pathname, body) {
  const okPost = method === "POST" && pathname === `/saas/companies/${COMPANY}/wallet-transactions`;
  if (method !== "GET" && !okPost) throw new Error(`blocked: ${method} ${pathname}`);
  for (let a = 0; a < 6; a++) {
    stats.calls++;
    const res = await fetch(BASE + pathname, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, Version: "v3", Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await sleep(2000 * 2 ** a); continue; }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status === 401 || res.status === 403) {
      console.error(`STOP ${res.status} on ${method} ${pathname}: ${text.slice(0, 300)}`);
      process.exit(2);
    }
    return { status: res.status, json };
  }
  throw new Error("429 retries exhausted");
}
export const walletTx = (skip, from, to, locationId, limit = 1000) =>
  call("POST", `/saas/companies/${COMPANY}/wallet-transactions`, {
    skip, limit, timezone: "UTC",
    filters: { settlementTime: { from, to }, ...(locationId ? { locationId } : {}) },
  });
export const walletBalance = (locationId) => call("GET", `/saas/companies/${COMPANY}/locations/${locationId}/wallet-balance`);
