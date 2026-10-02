// READ-ONLY analysis of out/{transactions,subscriptions,invoices}.json -> out/REPORT.md (masked).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const load = (f) => (fs.existsSync(path.join(out, f)) ? JSON.parse(fs.readFileSync(path.join(out, f), "utf8")).data : null);
const tx = load("transactions.json") ?? [];
const subs = load("subscriptions.json") ?? [];
const invs = load("invoices.json") ?? [];
const HQ = "KU2rSHDxTfZjZV1CxBkY";

// ---------- masking ----------
const NAME_PATH = /(^|\.)(contactName|firstName|lastName|fromName)$|contactDetails\.name$/;
const EMAIL_PATH = /email/i, IP_PATH = /(^|\.)(ipAddress|customerIP)$/, LAST4 = /last4|cardNumber/i, PHONE = /phone/i;
const maskNm = (s) => s.replace(/(Sub-Account - )(.+?)( of USD)/g, (_, a, n, b) => a + n.trim().split(/\s+/).map((w) => w[0] + "***").join(" ") + b).replace(/^(Subscription for |New Invoice_)(.*)$/s, (_, p, n) => p + n.trim().split(/\s+/).map((w) => w[0] + "***").join(" "));
const maskStr = (s) =>
  maskNm(s)
   .replace(/[\w.+-]+@([\w-]+)(\.[\w.-]+)/g, (_, d, t) => `***@${d[0]}***${t}`)
   .replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.$2.*.*");
function mask(p, v) {
  if (v == null || typeof v === "object") return v;
  const s = String(v);
  if (NAME_PATH.test(p)) return s.split(/\s+/).map((w) => w[0] + "***").join(" ");
  if (EMAIL_PATH.test(p) || IP_PATH.test(p)) return maskStr(s);
  if (LAST4.test(p)) return "****";
  if (PHONE.test(p)) return s.replace(/\d(?=\d{0,3}$)|\d/g, "*");
  return typeof v === "string" ? maskStr(s) : v;
}

// ---------- flatten ----------
function flat(o, prefix = "", acc = {}) {
  if (Array.isArray(o)) {
    if (!o.length) acc[prefix + "[]"] = "[]";
    o.forEach((x) => flat(x, prefix + "[]", acc));
  } else if (o && typeof o === "object") {
    const ks = Object.keys(o);
    if (!ks.length && prefix) acc[prefix] = "{}";
    // collapse UUID-keyed maps to <uuid>
    ks.forEach((k) => flat(o[k], prefix ? `${prefix}.${/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(k) ? "<uuid>" : k}` : k, acc));
  } else acc[prefix] = o;
  return acc;
}
const md = [];
const P = (s = "") => md.push(s);
const table = (head, rows) => { P(`| ${head.join(" | ")} |`); P(`|${head.map(() => "---").join("|")}|`); rows.forEach((r) => P(`| ${r.map((c) => maskNm(String(c ?? "")).replace(/\|/g, "\\|")).join(" | ")} |`)); P(); };
const count = (arr, fn) => { const m = new Map(); arr.forEach((x) => { const k = fn(x); m.set(k, (m.get(k) ?? 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
const day = (s) => (s ? String(s).slice(0, 10) : null);
const range = (arr, k = "createdAt") => { const d = arr.map((x) => x[k]).filter(Boolean).sort(); return d.length ? `${day(d[0])} → ${day(d.at(-1))}` : "n/a"; };
const money = (n) => (typeof n === "number" ? n.toFixed(2) : String(n));

P("# GHL HQ payment history — discovery report (masked)");
P(`Location: ${HQ}. Generated ${new Date().toISOString().slice(0, 10)}. Source: raw API pulls in out/. Emails, IPs, card last4, phones and person names masked. Orders not pulled (token lacks scope).`);
P();

// ---------- 1. counts ----------
P("## 1. Counts, date range, live vs test");
const live = (a) => a.filter((x) => x.liveMode === true).length;
table(["resource", "count", "created range", "live", "test", "other/undefined"], [
  ["transactions", tx.length, range(tx), live(tx), tx.filter((x) => x.liveMode === false).length, tx.filter((x) => typeof x.liveMode !== "boolean").length],
  ["subscriptions", subs.length, range(subs), live(subs), subs.filter((x) => x.liveMode === false).length, subs.filter((x) => typeof x.liveMode !== "boolean").length],
  ["invoices", invs.length, range(invs), live(invs), invs.filter((x) => x.liveMode === false).length, invs.filter((x) => typeof x.liveMode !== "boolean").length],
  ["orders", "skipped", "-", "-", "-", "missing scope"],
]);

// ---------- 2. field inventory ----------
P("## 2. Field inventory (every key path, % populated, masked examples)");
P("Populated = present and not null/empty string. Array elements are collapsed to `[]`; UUID-keyed maps to `<uuid>`.");
P();
for (const [name, arr] of [["transactions", tx], ["subscriptions", subs], ["invoices", invs]]) {
  P(`### ${name} (n=${arr.length})`);
  const stats = new Map();
  for (const r of arr) {
    const seen = new Set();
    for (const [p, v] of Object.entries(flat(r))) {
      let s = stats.get(p); if (!s) stats.set(p, (s = { n: 0, ex: new Map() }));
      if (v !== null && v !== "" && v !== undefined && !seen.has(p)) { s.n++; seen.add(p); }
      if (v !== null && v !== "" && s.ex.size < 3 && !s.ex.has(String(v))) s.ex.set(String(v), mask(p, v));
    }
  }
  table(["path", "% populated", "examples (masked)"], [...stats].sort().map(([p, s]) => [p, `${((100 * s.n) / arr.length).toFixed(0)}%`, [...s.ex.values()].map((v) => "`" + String(v).slice(0, 60) + "`").join(", ")]));
}

// ---------- 3. transaction grouping ----------
P("## 3. Transaction groupings");
const g = (label, fn) => { P(`### by ${label}`); table([label, "count"], count(tx, fn).slice(0, 40)); };
g("entityType", (t) => t.entityType);
g("entitySourceType", (t) => t.entitySourceType);
g("entitySourceSubType", (t) => t.entitySourceSubType);
g("entitySourceName", (t) => t.entitySourceName);
g("paymentProviderType", (t) => t.paymentProviderType);
g("has subscriptionId", (t) => (t.subscriptionId ? "yes" : "no"));
P("### by amount (top 30)"); table(["amount", "count"], count(tx, (t) => money(t.amount)).slice(0, 30));
P("### combination: entityType | entitySourceType | entitySourceSubType | hasSubscriptionId | amount (live only)");
const liveTx = tx.filter((t) => t.liveMode === true);
table(["combo", "count", "date range"], count(liveTx, (t) => [t.entityType, t.entitySourceType, t.entitySourceSubType, t.subscriptionId ? "sub" : "nosub", money(t.amount)].join(" | ")).map(([k, n]) => {
  const rows = liveTx.filter((t) => [t.entityType, t.entitySourceType, t.entitySourceSubType, t.subscriptionId ? "sub" : "nosub", money(t.amount)].join(" | ") === k);
  return [k, n, range(rows)];
}));
P("### amount = 57 breakdown (all modes)");
const t57 = tx.filter((t) => Number(t.amount) === 57);
table(["entityType | sourceType | subType | provider | hasSub | status | live", "count"], count(t57, (t) => [t.entityType, t.entitySourceType, t.entitySourceSubType, t.paymentProviderType, t.subscriptionId ? "sub" : "nosub", t.status, t.liveMode].join(" | ")));

// ---------- 4. join ----------
P("## 4. Transactions ⨝ subscriptions on subscriptionId");
const subById = new Map(subs.map((s) => [s._id, s]));
const withSubId = tx.filter((t) => t.subscriptionId);
const matched = withSubId.filter((t) => subById.has(t.subscriptionId));
P(`- Transactions with subscriptionId: ${withSubId.length} / ${tx.length} (${((100 * withSubId.length) / tx.length).toFixed(1)}%)`);
P(`- ...of which match a pulled subscription: ${matched.length}; orphan subscriptionIds: ${withSubId.length - matched.length}`);
const noSub = tx.filter((t) => !t.subscriptionId);
P(`- Transactions with NO subscriptionId: ${noSub.length} (${((100 * noSub.length) / tx.length).toFixed(1)}%). What they are:`);
P();
table(["entityType | sourceType | subType | sourceName | provider | amount", "count"], count(noSub, (t) => [t.entityType, t.entitySourceType, t.entitySourceSubType, t.entitySourceName, t.paymentProviderType, money(t.amount)].join(" | ")).slice(0, 40));
P("Subscription side:");
table(["field", "value", "count"], [
  ...count(subs, (s) => s.status).map(([k, n]) => ["status", k, n]),
  ...count(subs, (s) => s.recurringProduct?.product?.name).map(([k, n]) => ["recurringProduct.product.name", k, n]),
  ...count(subs, (s) => JSON.stringify(s.recurringProduct?.price?.recurring)).map(([k, n]) => ["price.recurring", k, n]),
  ...count(subs, (s) => money(s.amount)).map(([k, n]) => ["amount", k, n]),
  ...count(subs, (s) => s.entitySourceName).map(([k, n]) => ["entitySourceName", k, n]),
  ...count(subs, (s) => s.entityType + "/" + s.entitySourceType).map(([k, n]) => ["entityType/sourceType", k, n]),
]);
const perSub = count(withSubId, (t) => t.subscriptionId).map(([, n]) => n);
P(`Subscriptions with ≥1 transaction: ${new Set(withSubId.map((t) => t.subscriptionId)).size} / ${subs.length}. Max txns per subscription: ${Math.max(0, ...perSub)}.`);
P();

// ---------- 5. rebilling / wallet ----------
P("## 5. Rebilling / wallet charges");
const RE = /rebill|wallet|top.?up|recharge|credit|usage|sms|email|phone|lc[ _-]?(email|phone)|balance/i;
const hits = tx.filter((t) => RE.test(JSON.stringify([t.entityType, t.entitySourceType, t.entitySourceSubType, t.entitySourceName, t.chargeSnapshot?.order?.description, t.chargeSnapshot?.product])));
P(`Transactions whose entity/source/description fields match /rebill|wallet|top-up|recharge|credit|usage|sms|email|phone|balance/: **${hits.length}**.`);
P();
if (hits.length) table(["entityType | sourceType | subType | sourceName | description | amount", "count"], count(hits, (t) => [t.entityType, t.entitySourceType, t.entitySourceSubType, t.entitySourceName, t.chargeSnapshot?.order?.description, money(t.amount)].join(" | ")).slice(0, 30));
P("chargeSnapshot.order.description values (all txns):");
table(["description", "count"], count(tx, (t) => t.chargeSnapshot?.order?.description).slice(0, 30));
P("chargeSnapshot.product values:");
table(["product", "count"], count(tx, (t) => t.chargeSnapshot?.product));

// ---------- 6. status / refunds ----------
P("## 6. Status and refunds");
P("### transaction status (all distinct)"); table(["status", "count"], count(tx, (t) => t.status));
P("### chargeSnapshot.transactionStatus"); table(["value", "count"], count(tx, (t) => t.chargeSnapshot?.transactionStatus));
P("### chargeSnapshot.transactionType"); table(["value", "count"], count(tx, (t) => t.chargeSnapshot?.transactionType));
P("### chargeSnapshot.responseReasonDescription"); table(["value", "count"], count(tx, (t) => t.chargeSnapshot?.responseReasonDescription).slice(0, 20));
P("### paymentProviders[].chargeSnapshot.message (failures)"); table(["message", "count"], count(tx, (t) => t.paymentProviders?.[0]?.chargeSnapshot?.message).slice(0, 20));
P("### status × amountRefunded");
table(["status | amountRefunded>0 | amountRefunded key present", "count"], count(tx, (t) => [t.status, (t.amountRefunded ?? 0) > 0, "amountRefunded" in t].join(" | ")));
const refunded = tx.filter((t) => (t.amountRefunded ?? 0) > 0);
P(`Refunded txns: ${refunded.length}. amountRefunded vs amount: ` + (refunded.length ? count(refunded, (t) => (t.amountRefunded === t.amount ? "full" : "partial")).map(([k, n]) => `${k}=${n}`).join(", ") : "n/a"));
P();
P("### invoice status"); table(["status", "count"], count(invs, (i) => i.status));
P("### subscription status"); table(["status", "count"], count(subs, (s) => s.status));

// ---------- 7. processor eras ----------
P("## 7. Processor eras");
table(["paymentProviderType", "count", "first", "last", "live", "test"], count(tx, (t) => t.paymentProviderType).map(([k]) => {
  const r = tx.filter((t) => t.paymentProviderType === k); const d = r.map((t) => t.createdAt).sort();
  return [k, r.length, day(d[0]), day(d.at(-1)), live(r), r.length - live(r)];
}));
P("Provider × month (live):");
const months = [...new Set(liveTx.map((t) => day(t.createdAt)?.slice(0, 7)))].sort();
const provs = [...new Set(tx.map((t) => t.paymentProviderType))];
table(["month", ...provs], months.map((m) => [m, ...provs.map((p) => liveTx.filter((t) => day(t.createdAt)?.startsWith(m) && t.paymentProviderType === p).length)]));
P("paymentProviderConnectedAccount distinct (masked to last 4 chars):");
table(["account", "provider", "count"], count(tx, (t) => `…${String(t.paymentProviderConnectedAccount ?? "").slice(-4)} | ${t.paymentProviderType}`).map(([k, n]) => [k.split(" | ")[0], k.split(" | ")[1], n]));

// ---------- 8. identity ----------
P("## 8. Identity: anything revealing a member's own sub-account/location ID or mapping contactId → sub-account");
const ID24 = /^[A-Za-z0-9]{20}$/;
const locKey = /loc|account|altid|company|agency|sub_?account|tenant|workspace|source_?id/i;
const cand = new Map(); // path -> Map(value->count)
const all = [["tx", tx], ["sub", subs], ["inv", invs]];
for (const [tag, arr] of all) for (const r of arr) for (const [p, v] of Object.entries(flat(r))) {
  if (typeof v !== "string") continue;
  const p2 = `${tag}:${p}`;
  const isKey = locKey.test(p.split(".").pop());
  const isHQ = v === HQ;
  if (isKey || isHQ) { let m = cand.get(p2); if (!m) cand.set(p2, (m = new Map())); m.set(v, (m.get(v) ?? 0) + 1); }
}
table(["path", "distinct values", "equals HQ id?", "sample (id tail)"], [...cand].map(([p, m]) => [p, m.size, [...m.keys()].some((k) => k === HQ) ? (m.size === 1 ? "always" : "sometimes") : "never", [...m.keys()].slice(0, 3).map((k) => "…" + k.slice(-4)).join(", ")]));
// any string value anywhere that looks like a GHL id but appears as a non-HQ altId-like: check free-text fields for location-like strings
const freeText = [];
for (const [tag, arr] of all) for (const r of arr) for (const [p, v] of Object.entries(flat(r))) {
  if (typeof v === "string" && /location|sub.?account|app\.[\w-]+\.com|leadconnector|gohighlevel|whitelabel/i.test(v) && !/^(location)$/.test(v)) freeText.push(`${tag}:${p}`);
}
P("Free-text/URL values mentioning location/sub-account/GHL hosts:");
table(["path", "count"], count(freeText, (x) => x));
P("contactId cardinality: " + `${new Set(tx.map((t) => t.contactId)).size} distinct contactIds across ${tx.length} txns; ${new Set(subs.map((s) => s.contactId)).size} across ${subs.length} subs.`);
P("Per-record ID fields that could carry an external key (populated %):");
const idFields = ["entityId", "entitySourceId", "chargeId", "subscriptionId", "paymentProviderConnectedAccount", "chargeSnapshot.customer.id", "chargeSnapshot.profile.customerProfileId"];
table(["field", "populated %", "distinct"], idFields.map((f) => { const vals = tx.map((t) => f.split(".").reduce((o, k) => o?.[k], t)).filter(Boolean); return [f, ((100 * vals.length) / tx.length).toFixed(0) + "%", new Set(vals).size]; }));


// ---------- 8b. wallet / location-id extraction ----------
P("### 8b. Location IDs embedded in free text (wallet auto-recharges)");
const desc = (t) => t.entitySourceMeta?.description ?? t.chargeSnapshot?.order?.description ?? "";
const LOCRE = /\/location\/([A-Za-z0-9]{20})\//;
const walletTx = tx.filter((t) => t.entitySourceSubType === "saas_one_time");
const kind = (t) => /^Auto-Recharge/.test(desc(t)) ? "auto-recharge" : /^Manual Recharge/.test(desc(t)) ? "manual-recharge" : "other/blank";
P(`saas_one_time transactions: ${walletTx.length}`);
table(["kind (from entitySourceMeta.description)", "count", "with /location/<id>/ URL", "with 'Sub-Account - <name> of USD'", "fractional-cent amounts", "live", "test"], count(walletTx, kind).map(([k, n]) => {
  const r = walletTx.filter((t) => kind(t) === k);
  return [k, n, r.filter((t) => LOCRE.test(desc(t))).length, r.filter((t) => /Sub-Account - .+ of USD/.test(desc(t))).length, r.filter((t) => Math.abs(t.amount * 100 - Math.round(t.amount * 100)) > 1e-6).length, live(r), r.length - live(r)];
}));
const mk = (id) => "…" + id.slice(-4);
const byLoc = new Map();
for (const t of walletTx) { const m = desc(t).match(LOCRE); if (m) { if (!byLoc.has(m[1])) byLoc.set(m[1], []); byLoc.get(m[1]).push(t); } }
P(`Distinct member location IDs recoverable from descriptions: **${byLoc.size}** (none equal HQ: ${!byLoc.has(HQ)}).`);
P(`Same description in entitySourceMeta.description vs chargeSnapshot.order.description: ${walletTx.filter((t) => t.entitySourceMeta?.description && t.entitySourceMeta.description === t.chargeSnapshot?.order?.description).length} identical of ${walletTx.length}.`);
const locsPerContact = new Map();
for (const [loc, rows] of byLoc) for (const t of rows) { if (!locsPerContact.has(t.contactId)) locsPerContact.set(t.contactId, new Set()); locsPerContact.get(t.contactId).add(loc); }
const contactsPerLoc = [...byLoc].map(([loc, rows]) => new Set(rows.map((t) => t.contactId)).size);
P(`contactIds attached to auto-recharge txns: ${locsPerContact.size}. Contacts mapping to exactly 1 location: ${[...locsPerContact.values()].filter((s) => s.size === 1).length}; to >1: ${[...locsPerContact.values()].filter((s) => s.size > 1).length}. Locations mapped to >1 contactId: ${contactsPerLoc.filter((n) => n > 1).length} of ${byLoc.size}.`);
const hqContactIds = new Set([...tx, ...subs].filter((r) => !(r.entitySourceSubType === "saas_one_time")).map((r) => r.contactId));
P(`Of contactIds on auto-recharge txns, also present on non-wallet txns/subs (i.e. also a paying $57 member contact): ${[...locsPerContact.keys()].filter((c) => hqContactIds.has(c)).length}/${locsPerContact.size}.`);
const subsWithLoc = new Set([...byLoc.keys()]);
P(`chargeSnapshot.locationId on transactions (masked): ${count(tx.filter((t) => t.chargeSnapshot?.locationId), (t) => mk(t.chargeSnapshot.locationId)).map(([k, n]) => k + "×" + n).join(", ") || "none"} (is this an HQ-side or member ID? see 'equals HQ id?' above).`);
P();

// ---------- 9. surprises ----------
P("## 9. Unclassifiable / surprising");
const surprises = [];
const dupCharge = count(tx.filter((t) => t.chargeId), (t) => t.chargeId).filter(([, n]) => n > 1).length;
if (dupCharge) surprises.push(`${dupCharge} chargeIds appear on more than one transaction.`);
const zero = tx.filter((t) => !t.amount).length; if (zero) surprises.push(`${zero} transactions have zero/missing amount.`);
const orphan = withSubId.length - matched.length; if (orphan) surprises.push(`${orphan} transactions reference subscriptionIds not in the subscription pull.`);
const testWithLiveProv = tx.filter((t) => t.liveMode === false && t.paymentProviderType && t.paymentProviderType !== "stripe").length;
if (testWithLiveProv) surprises.push(`${testWithLiveProv} test-mode transactions use a non-stripe provider.`);
const modeMismatch = tx.filter((t) => t.chargeSnapshot && t.liveMode === false && t.status === "succeeded").length;
surprises.push(`${modeMismatch} test-mode transactions have status succeeded.`);
const noContact = tx.filter((t) => !t.contactId).length; if (noContact) surprises.push(`${noContact} transactions have no contactId.`);
const unmapped = tx.filter((t) => !t.entitySourceType && !t.entitySourceName).length; if (unmapped) surprises.push(`${unmapped} transactions have neither entitySourceType nor entitySourceName.`);
surprises.forEach((s) => P("- " + s));
P();

// ---------- 10. recommended rules ----------
P("## 10. Candidate classification rules (to be confirmed against sections 3–7)");
P("Hand-written from the tables above. Confidence = how cleanly the rule separates classes in this data set (707 txns), not a guarantee for future events.");
P();
table(["#", "rule (observed data only)", "confidence"], [
  [1, "Ignore test data: liveMode === false (42 txns, all stripe, Jun–Aug). Filter first.", "High"],
  [2, "Wallet charge: entitySourceSubType === 'saas_one_time' (457; entityType manual, entitySourceName 'Manual Payment', no subscriptionId, amounts ~$4–$100). Auto-recharge if entitySourceMeta.description starts 'Auto-Recharge for Sub-Account' (357, all carry /location/<id>/ URL + business name, 256 have fractional-cent amounts); manual recharge if it starts 'Manual Recharge for Location Wallet' (100).", "High (subType is 100% consistent in this set)"],
  [3, "Wallet-charge → member sub-account: parse /location/<20-char id>/ from entitySourceMeta.description (auto-recharge only). Manual recharges: 12 of 100 carry a URL, the rest have no location identifier.", "High for auto-recharge; none for most manual"],
  [4, "$57 SaaS subscription charge: amount === 57 AND entitySourceSubType !== 'saas_one_time' AND liveMode. There is no single field: stripe era = order|payment_link|payments_dashboard with subscriptionId; Square/A.net era = order|manual|saas_subscription with subscriptionId; A.net dunning/retry style = entityType 'invoice' | payments_subscription. Amount alone is not enough (8 payment_link 57.00 rows have no subscriptionId and all failed).", "Medium — needs the 3-way OR"],
  [5, "$0.00 transactions (91): trial/authorization rows (entitySourceName '7 Day Trial', '30 Day Trial', $0 subscription starts). Not revenue.", "High for amount==0; medium on meaning"],
  [6, "Failed payment: status === 'failed' (194); decline reason in chargeSnapshot.responseReasonDescription (A.net) or paymentProviders[0].chargeSnapshot.message. Pending: status 'pending' (4).", "High"],
  [7, "Refund: status === 'refunded' with amountRefunded === amount (2, both full). amountRefunded is present (0) on every record; no partial refunds observed.", "High but n=2"],
  [8, "Subscription linkage: 109 of 226 transactions with subscriptionId match a pulled subscription; 117 reference unpulled subscriptionIds (likely older/other statuses or pull limits) — do not assume subscription lookups succeed.", "Medium"],
  [9, "Processor era is derived from paymentProviderType: stripe through 2026-08-04, square 2026-08-05→08-10, authorize-net from 2026-08-19. Do not key logic on provider.", "High"],
]);

fs.writeFileSync(path.join(out, "REPORT.md"), md.join("\n"));
console.log("wrote out/REPORT.md", md.length, "lines");
