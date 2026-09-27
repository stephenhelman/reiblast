// READ-ONLY. Full unfiltered August wallet transactions (paginated by skip).
import fs from "node:fs";
import path from "node:path";
import { out, walletTx, stats } from "./wallet-lib.mjs";
const FROM = "2026-08-01T00:00:00.000Z", TO = "2026-08-31T23:59:59.999Z";
let skip = 0, rows = [];
for (;;) {
  const t = (await walletTx(skip, FROM, TO, null)).json?.data?.transactions;
  if (!Array.isArray(t)) { console.error("unexpected response"); process.exit(3); }
  rows.push(...t);
  if (t.length < 1000) break;
  skip += 1000;
}
fs.writeFileSync(path.join(out, "wallet-aug-unfiltered-full.json"), JSON.stringify(rows));
console.log("rows", rows.length, "unique ids", new Set(rows.map((r) => r.id)).size, "calls", stats.calls);
