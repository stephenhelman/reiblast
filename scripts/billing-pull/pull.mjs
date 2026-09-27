// READ-ONLY GHL payment history pull. GET requests only. Output: ./out/*.json (gitignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

// minimal .env.local loader (no value printing)
for (const f of [".env.local", ".env"]) {
  const p = path.join(here, "..", "..", f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const TOKEN = process.env.GHL_HQ_API_KEY;
const LOC = process.env.GHL_HQ_LOCATION_ID;
if (!TOKEN || LOC !== "KU2rSHDxTfZjZV1CxBkY") throw new Error("missing token or unexpected location id");

const BASE = "https://services.leadconnectorhq.com";
let version = "v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, body) { super(`HTTP ${status}`); this.status = status; this.body = body; }
}

let optional = false;
async function get(pathname, params) {
  const url = `${BASE}${pathname}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${TOKEN}`, Version: version, Accept: "application/json" } });
    if (res.status === 429) { await sleep(2000 * 2 ** attempt); continue; }
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (res.status === 401 && !optional) { console.error(`401 on ${pathname} — stopping. ${text.slice(0, 200)}`); process.exit(2); }
    if (!res.ok) throw new HttpError(res.status, body);
    return body;
  }
  throw new Error("429 retries exhausted");
}

// Version negotiation: v3 first, fall back to 2021-07-28 on rejection (non-401).
async function probe() {
  const base = { altId: LOC, altType: "location", limit: "1", offset: "0" };
  for (const v of ["v3", "2021-07-28"]) {
    version = v;
    try { await get("/payments/transactions", base); console.log(`Version header accepted: ${v}`); return; }
    catch (e) { console.log(`Version ${v} rejected: ${e.status} ${JSON.stringify(e.body).slice(0, 200)}`); }
  }
  throw new Error("no version accepted");
}

async function paginate(name, pathname, params, listKeys) {
  let limit = 100, offset = 0, all = [], pages = [], total = null;
  for (;;) {
    let body;
    try { body = await get(pathname, { ...params, limit: String(limit), offset: String(offset) }); }
    catch (e) {
      if (e.status === 422 || e.status === 400) {
        if (limit > 10) { console.log(`${name}: limit=${limit} rejected (${e.status}), trying ${limit === 100 ? 50 : 10}`); limit = limit === 100 ? 50 : 10; continue; }
      }
      throw e;
    }
    const key = listKeys.find((k) => Array.isArray(body[k]));
    if (!key) throw new Error(`${name}: no list key in response keys ${Object.keys(body)}`);
    const rows = body[key];
    total = body.totalCount ?? body.total ?? total;
    all.push(...rows);
    pages.push({ offset, limit, returned: rows.length, topLevelKeys: Object.keys(body) });
    console.log(`${name}: offset=${offset} got=${rows.length} total=${total}`);
    if (rows.length === 0 || (total != null && all.length >= total) || rows.length < limit && total == null) break;
    offset += rows.length;
    await sleep(150);
  }
  return { key: listKeys[0], totalCount: total, fetched: all.length, pages, data: all };
}

const save = (f, o) => fs.writeFileSync(path.join(out, f), JSON.stringify(o, null, 2));
const base = { altId: LOC, altType: "location" };
const meta = { version: null, resources: {} };

await probe();
meta.version = version;

// 1. Transactions: compare no-paymentMode vs paymentMode=live (and test)
const T = ["data", "transactions"];
const noMode = await paginate("tx(no paymentMode)", "/payments/transactions", base, T);
const summary = { noPaymentMode: noMode.fetched };
for (const m of ["live", "test"]) {
  try { summary[m] = (await paginate(`tx(${m})`, "/payments/transactions", { ...base, paymentMode: m }, T)).fetched; }
  catch (e) { summary[m] = `error ${e.status}`; }
}
console.log("transaction count comparison", summary);
save("transactions.json", noMode);
meta.resources.transactions = { ...summary, note: "transactions.json = no paymentMode filter" };

// 2. Subscriptions
try {
  const s = await paginate("subscriptions", "/payments/subscriptions", { ...base, getPaymentsCollectedCount: "true" }, ["data", "subscriptions"]);
  save("subscriptions.json", s); meta.resources.subscriptions = { fetched: s.fetched, totalCount: s.totalCount };
} catch (e) { meta.resources.subscriptions = { error: e.status, body: e.body }; }

// 3. Invoices and orders
optional = true;
for (const [name, p, keys] of [["invoices", "/invoices/", ["invoices", "data"]], ["orders", "/payments/orders", ["data", "orders"]]]) {
  try {
    const r = await paginate(name, p, base, keys);
    save(`${name}.json`, r); meta.resources[name] = { fetched: r.fetched, totalCount: r.totalCount };
  } catch (e) {
    meta.resources[name] = { skipped: true, error: e.status, body: e.body };
    console.log(`${name} skipped: ${e.status} ${JSON.stringify(e.body).slice(0, 300)}`);
  }
}
save("_meta.json", meta);
console.log("done", JSON.stringify(meta));
