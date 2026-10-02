// READ-ONLY analysis of saved wallet files. Writes out/WALLET-REPORT-2.md
import fs from "node:fs";
import path from "node:path";
import { out } from "./wallet-lib.mjs";
const CATS = [
  ["outbound_sms", /^Outbound SMS/], ["inbound_sms", /^Inbound SMS/], ["outbound_mms", /^Outbound MMS/], ["inbound_mms", /^Inbound MMS/],
  ["sms_carrier_fee", /^SMS Carrier Fees/], ["mms_carrier_fee", /^MMS Carrier Fees/],
  ["outbound_call", /^Outbound Call/], ["inbound_call", /^Inbound Call/],
  ["call_recording_storage", /^Call Recording Storage/], ["call_recordings", /^Call Recordings/],
  ["phone_number_monthly", /^Monthly charge for .*phone number/i], ["text_to_speech", /^Text to Speech/],
  ["a2p_registration", /^A2P Registration/], ["a2p_fast_track", /^A2P Fast Track/],
  ["email", /^Email ref/], ["email_notification", /^EmailNotification/],
  ["agency_auto_recharge", /^Auto-Recharge for Agency/], ["wallet_sales_tax", /^WALLET_SALES_TAX/],
];
const cat = (d) => (CATS.find(([, re]) => re.test(d)) ?? ["other"])[0];
const norm = (d) => d.replace(/[0-9a-zA-Z]{18,}/g, "*").replace(/\+?\d[\d.]*/g, "#");
const files = fs.readdirSync(path.join(out, "wallet-aug"));
const rows = [], memberNames = new Map();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(out, "wallet-aug", f)));
  for (const r of j.rows) rows.push({ ...r, loc: j.locationId });
  if (j.rows[0]) memberNames.set(j.rows[0].locationName, j.locationId);
}
const day = JSON.parse(fs.readFileSync(path.join(out, "wallet-aug-unfiltered-day1.json")));
const meta = JSON.parse(fs.readFileSync(path.join(out, "wallet-agency-meta.json")));
const bal = JSON.parse(fs.readFileSync(path.join(out, "wallet-balances.json")));
const r6 = (n) => +n.toFixed(6);
const L = []; const p = (s = "") => { L.push(s); console.log(s); };
const l4 = (id) => "…" + id.slice(-4);

p("# Wallet pull #2 report — August 2026 (masked)\n");
p(`Member locations queried: ${files.length}; with ≥1 August row: ${new Set(rows.map((r) => r.loc)).size}`);
p(`Per-location rows: ${rows.length}; unfiltered August total (skip binary search): ${meta.total}; difference (non-member/agency rows): ${meta.total - rows.length}`);
const ids = new Set(rows.map((r) => r.id)); p(`Unique transaction ids: ${ids.size} (dupes: ${rows.length - ids.size})`);
const dec = Math.max(...rows.map((r) => (String(r.amount).split(".")[1] ?? "").length)); p(`Max decimal places in amount: ${dec}`);
p(`Blank locationName in member rows: ${rows.filter((r) => !r.locationName || r.locationName === "-").length}`);
p(`Positive-amount member rows: ${rows.filter((r) => r.amount > 0).length}; zero-amount: ${rows.filter((r) => r.amount === 0).length}`);
const st = rows.map((r) => r.settlementTime).sort(); p(`Range: ${st[0]} → ${st.at(-1)}\n`);

p("## Usage by category (member locations, August)");
const byCat = {}; const other = {};
for (const r of rows) { const c = cat(r.description); const o = (byCat[c] ??= { n: 0, sum: 0 }); o.n++; o.sum += r.amount; if (c === "other") other[norm(r.description)] = (other[norm(r.description)] ?? 0) + 1; }
p("| category | rows | sum |\n|---|---|---|");
let tot = 0; for (const [c, o] of Object.entries(byCat).sort((a, b) => a[1].sum - b[1].sum)) { p(`| ${c} | ${o.n} | ${r6(o.sum)} |`); tot += o.sum; }
p(`| **total** | ${rows.length} | ${r6(tot)} |`);
p(`\n"other" distinct descriptions: ${Object.keys(other).length}`); for (const [d, n] of Object.entries(other)) p(`- ${n} × ${d.slice(0, 100)}`);

p("\n## Per-location August cost (top 10 of those with activity)");
const byLoc = {}; for (const r of rows) { const o = (byLoc[r.loc] ??= { n: 0, cost: 0 }); o.n++; o.cost += r.amount; }
const ranked = Object.entries(byLoc).sort((a, b) => a[1].cost - b[1].cost);
p("| location | rows | cost |\n|---|---|---|"); for (const [l, o] of ranked.slice(0, 10)) p(`| ${l4(l)} | ${o.n} | ${r6(o.cost)} |`);
const costs = ranked.map(([, o]) => -o.cost); const totalCost = costs.reduce((a, b) => a + b, 0);
p(`\nActive locations: ${ranked.length}; total member usage cost: ${r6(totalCost)}; median ${r6(costs.sort((a, b) => a - b)[Math.floor(costs.length / 2)])}; top-3 share ${((ranked.slice(0, 3).reduce((a, [, o]) => a - o.cost, 0) / totalCost) * 100).toFixed(1)}%`);

p("\n## Non-member / agency-level rows (from unfiltered Aug 1, full day)");
const nonMem = day.filter((r) => !memberNames.has(r.locationName));
p(`Aug 1 unfiltered rows: ${day.length}; not attributable to a queried member location: ${nonMem.length}; blank locationName: ${day.filter((r) => !r.locationName || r.locationName === "-").length}`);
const nm = {}; for (const r of nonMem) { const k = `${cat(r.description)} | name=${r.locationName ? "named(masked)" : "blank"}`; const o = (nm[k] ??= { n: 0, sum: 0 }); o.n++; o.sum += r.amount; }
for (const [k, o] of Object.entries(nm)) p(`- ${k}: ${o.n} rows, sum ${r6(o.sum)}`);
const dn = {}; for (const r of nonMem) if (!r.locationName || r.locationName === "-") dn[norm(r.description).slice(0, 80)] = (dn[norm(r.description).slice(0, 80)] ?? 0) + 1;
p("Blank-name distinct descriptions: " + JSON.stringify(dn));
const unmatched = day.filter((r) => cat(r.description) === "other"); p(`Aug 1 rows in "other": ${unmatched.length}`);
p(`Distinct non-member location names on Aug 1: ${new Set(nonMem.map((r) => r.locationName || "(blank)")).size}`);
p("Agency auto-recharge August total: NOT pulled (would need the full unfiltered month, " + Math.ceil(meta.total / 1000) + " calls) — Aug 1 sample: " + r6(nonMem.filter((r) => cat(r.description) === "agency_auto_recharge").reduce((a, r) => a + r.amount, 0)));

p("\n## Balances");
const ok = bal.filter((b) => b.status === 200), bad = bal.filter((b) => b.status !== 200);
const bs = ok.map((b) => b.body.data.balance); const cc = ok.filter((b) => b.body.data.complimentaryCredits);
p(`Locations: ${bal.length}; 200 OK: ${ok.length}; non-200: ${bad.length} (${[...new Set(bad.map((b) => b.status + " " + b.body.error))].join(", ")})`);
p(`Negative balances: ${bs.filter((x) => x < 0).length}; min ${Math.min(...bs)}; max ${Math.max(...bs)}; zero: ${bs.filter((x) => x === 0).length}; sum ${r6(bs.reduce((a, b) => a + b, 0))}`);
p(`complimentaryCredits in use (non-zero): ${cc.length}` + (cc.length ? " → " + cc.map((b) => `${l4(b.locationId)}=${b.body.data.complimentaryCredits}`).join(", ") : ""));
const badWith = bad.filter((b) => byLoc[b.locationId]).length; p(`Non-200 locations that had August usage rows: ${badWith}`);

p("\n## Rollup sizing");
const roll = new Set(rows.map((r) => `${r.loc}|${r.settlementTime.slice(0, 10)}|${cat(r.description)}`)); p(`Distinct (location, day, category) keys in August: ${roll.size} vs ${rows.length} raw rows → ${(rows.length / roll.size).toFixed(1)}× compression`);
const perLoc = ranked.map(([, o]) => o.n).sort((a, b) => b - a); p(`Raw rows per active location in August: max ${perLoc[0]}, median ${perLoc[Math.floor(perLoc.length / 2)]}, min ${perLoc.at(-1)}`);
p(`Raw description coverage: "other" = ${byCat.other?.n ?? 0} of ${rows.length}`);
fs.writeFileSync(path.join(out, "WALLET-REPORT-2.md"), L.join("\n"));
