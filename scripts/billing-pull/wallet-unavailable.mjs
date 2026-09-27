import fs from "node:fs";
import path from "node:path";
import { out } from "./wallet-lib.mjs";
const bal = JSON.parse(fs.readFileSync(path.join(out, "wallet-balances.json")));
const seed = JSON.parse(fs.readFileSync(path.join(out, "seed-final-state.json")));
const byLoc = new Map(seed.map((s) => [s.locationId, s]));
const rows = bal.filter((b) => b.status !== 200).map((b) => {
  const w = JSON.parse(fs.readFileSync(path.join(out, "wallet-aug", b.locationId + ".json"))).rows;
  const s = byLoc.get(b.locationId);
  return { loc: "…" + b.locationId.slice(-4), status: b.status, augRows: w.length, augCost: +w.reduce((a, r) => a + r.amount, 0).toFixed(4), state: s?.billingState ?? "null", legacy: !!s?.legacyUnreconciled, pause: s?.pauseReason ?? "" };
});
const md = ["| location | HTTP | Aug rows | Aug cost | seeded state | pauseReason | legacy |", "|---|---|---|---|---|---|---|", ...rows.map((r) => `| ${r.loc} | ${r.status} | ${r.augRows} | ${r.augCost} | ${r.state} | ${r.pause} | ${r.legacy} |`)].join("\n");
console.log(md);
const okBal = bal.filter((b) => b.status === 200);
console.log("\nseeded state of the 66 with a balance:", JSON.stringify(okBal.reduce((m, b) => { const k = byLoc.get(b.locationId)?.billingState ?? "null"; m[k] = (m[k] || 0) + 1; return m; }, {})));
fs.appendFileSync(path.join(out, "WALLET-REPORT-2.md"), "\n\n## WALLET_BALANCE_UNAVAILABLE locations\n" + md + "\n");
