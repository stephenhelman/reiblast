// READ-ONLY. (a) unfiltered August total via skip binary search, (b) unfiltered Aug 1 full day, (c) wallet balances per member location.
import fs from "node:fs";
import path from "node:path";
import { out, walletTx, walletBalance, stats } from "./wallet-lib.mjs";
const FROM = "2026-08-01T00:00:00.000Z", TO = "2026-08-31T23:59:59.999Z";
const tx = async (skip, from, to, limit) => (await walletTx(skip, from, to, null, limit)).json?.data?.transactions;

// (a) total count: smallest skip with empty page
let lo = 0, hi = 262144; // lo: known non-empty (assumed), hi: known empty?
if ((await tx(hi, FROM, TO, 1))?.length) { console.log("hi bound too small"); process.exit(5); }
if (!(await tx(0, FROM, TO, 1))?.length) { console.log("no rows"); process.exit(5); }
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1;
  ((await tx(mid, FROM, TO, 1))?.length ? (lo = mid) : (hi = mid));
}
const total = hi;
console.log("unfiltered August total records:", total, "| calls so far", stats.calls);

// (b) Aug 1 full day, unfiltered
const D1 = "2026-08-01T00:00:00.000Z", D2 = "2026-08-01T23:59:59.999Z";
let skip = 0, day = [];
for (;;) { const t = await tx(skip, D1, D2, 1000); day.push(...t); if (t.length < 1000) break; skip += 1000; }
console.log("Aug 1 unfiltered rows:", day.length);
fs.writeFileSync(path.join(out, "wallet-aug-unfiltered-day1.json"), JSON.stringify(day));

// (c) balances
const files = fs.readdirSync(path.join(out, "wallet-aug"));
const locs = files.map((f) => f.replace(".json", ""));
const bal = [];
for (const loc of locs) {
  const r = await walletBalance(loc);
  bal.push({ locationId: loc, status: r.status, body: r.json });
}
fs.writeFileSync(path.join(out, "wallet-balances.json"), JSON.stringify(bal));
console.log("balances fetched:", bal.length, "statuses:", [...new Set(bal.map((b) => b.status))]);
fs.writeFileSync(path.join(out, "wallet-agency-meta.json"), JSON.stringify({ total, dayRows: day.length, calls: stats.calls }));
console.log("API calls this script:", stats.calls);
