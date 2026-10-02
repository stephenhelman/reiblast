import fs from "node:fs";
import path from "node:path";
import { out, walletTx, idsEqual } from "./wallet-lib.mjs";
console.log("GHL_COMPANY_ID === GHL_AGENCY_ID:", idsEqual);
const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
const r = await walletTx(0, from.toISOString(), to.toISOString());
fs.writeFileSync(path.join(out, "wallet-sample.json"), JSON.stringify(r, null, 1));
console.log("status", r.status);
const j = r.json;
console.log("top-level keys:", typeof j === "object" ? Object.keys(j) : String(j).slice(0, 200));
const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? [];
console.log("records:", arr.length);
for (const k of Object.keys(j)) if (!Array.isArray(j[k])) console.log("meta", k, JSON.stringify(j[k]).slice(0, 120));
// shape only: key -> type, value masked except non-PII scalars
const mask = (k, v) => /name|email|phone/i.test(k) ? "<masked>" : /(^|_)(id|locationId)$/i.test(k) && typeof v === "string" ? "…" + v.slice(-4) : v;
if (arr[0]) console.log(JSON.stringify(Object.fromEntries(Object.entries(arr[0]).map(([k, v]) => [k, typeof v === "object" && v ? v : mask(k, v)])), null, 1));
