import fs from "node:fs";
import path from "node:path";
import { out } from "./wallet-lib.mjs";
const full = JSON.parse(fs.readFileSync(path.join(out, "wallet-aug-unfiltered-full.json")));
const memberIds = new Set(), memberNames = new Set();
for (const f of fs.readdirSync(path.join(out, "wallet-aug"))) {
  for (const r of JSON.parse(fs.readFileSync(path.join(out, "wallet-aug", f))).rows) { memberIds.add(r.id); memberNames.add(r.locationName); }
}
const missing = [...memberIds].filter((id) => !full.some ? false : false).length; // placeholder
const fullIds = new Set(full.map((r) => r.id));
console.log("member ids not in unfiltered:", [...memberIds].filter((i) => !fullIds.has(i)).length);
const non = full.filter((r) => !memberIds.has(r.id));
const CATS = [["agency_auto_recharge", /^Auto-Recharge for Agency/], ["wallet_sales_tax", /^WALLET_SALES_TAX/], ["email", /^Email ref/], ["email_notification", /^EmailNotification/], ["outbound_sms", /^Outbound SMS/], ["inbound_sms", /^Inbound SMS/], ["sms_carrier_fee", /^SMS Carrier/], ["a2p", /^A2P/], ["phone_number_monthly", /^Monthly charge/]];
const cat = (d) => (CATS.find(([, re]) => re.test(d)) ?? ["other"])[0];
const mask = (n) => !n || n === "-" ? "(blank '-')" : n.slice(0, 2) + "***(" + n.length + ")";
console.log("non-member rows:", non.length, "of", full.length);
const g = {};
for (const r of non) { const k = `${cat(r.description)} | ${mask(r.locationName)}`; const o = (g[k] ??= { n: 0, sum: 0, first: r.settlementTime, last: r.settlementTime }); o.n++; o.sum += r.amount; o.first = o.first < r.settlementTime ? o.first : r.settlementTime; o.last = o.last > r.settlementTime ? o.last : r.settlementTime; }
console.log("category | name | rows | sum");
for (const [k, o] of Object.entries(g).sort((a, b) => b[1].n - a[1].n)) console.log(`${k} | ${o.n} | ${+o.sum.toFixed(6)}`);
const by = (c) => non.filter((r) => cat(r.description) === c);
for (const c of ["agency_auto_recharge", "wallet_sales_tax"]) { const x = by(c); console.log(c, "rows", x.length, "total", +x.reduce((a, r) => a + r.amount, 0).toFixed(6)); }
const rech = by("agency_auto_recharge").map((r) => r.amount); console.log("recharge amounts: min", Math.min(...rech), "max", Math.max(...rech), "distinct", [...new Set(rech.map((x) => +x.toFixed(2)))].sort((a, b) => a - b).join(","));
const tax = by("wallet_sales_tax"); console.log("tax by day:", tax.slice(0, 6).map((r) => r.settlementTime.slice(0, 10) + ":" + r.amount).join(" "));
console.log("other rows:", by("other").length, [...new Set(by("other").map((r) => r.description.replace(/[0-9a-zA-Z]{18,}/g, "*").slice(0, 70)))]);
console.log("sum all non-member:", +non.reduce((a, r) => a + r.amount, 0).toFixed(6), "| cost only (neg):", +non.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0).toFixed(6));
const blankRows = full.filter((r) => !r.locationName || r.locationName === "-"); console.log("all blank-name rows in full month:", blankRows.length, "of which member ids:", blankRows.filter((r) => memberIds.has(r.id)).length);
