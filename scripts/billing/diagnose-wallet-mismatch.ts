/**
 * READ-ONLY. Explains a UsageRollup-vs-WalletTransaction mismatch for specific locations on one UTC day: re-fetches the
 * same window from GHL (the same paged call the job uses) and compares with the stored rows. Writes nothing.
 *
 *   BILLING_DB_TARGET=prod DATABASE_URL="$PROD_URL" npx tsx scripts/billing/diagnose-wallet-mismatch.ts \
 *     --day=2026-10-15 --locations=ID1,ID2,ID3 --i-mean-production
 *
 * Prints, per location: rows GHL returns, DUPLICATE ids inside that response (pagination overlap — the job's rollup counts
 * every returned row but the table keeps one per id), ids stored under a DIFFERENT scope, ids missing from the table, and
 * stored rows GHL no longer returns. Ids are shown as …last6; no descriptions or names are printed.
 */
import { walletTransactionsPage } from "../../lib/billing/ghlWallet";
import { parseWalletCategory } from "../../lib/billing/walletCategories";
import { arg, connect } from "./_cli";

const { db } = await connect();
const day = arg("day");
const locations = (arg("locations") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || locations.length === 0) throw new Error("usage: --day=YYYY-MM-DD --locations=ID1,ID2 [--category=outbound_sms]");
const category = arg("category") ?? "outbound_sms";
const from = `${day}T00:00:00.000Z`, to = `${day}T23:59:59.999Z`;
const t6 = (s: string) => `…${s.slice(-6)}`;

async function fetchAll(locationId: string) {
  const rows: Awaited<ReturnType<typeof walletTransactionsPage>> = [];
  for (let skip = 0; ; skip += 1000) {
    const page = await walletTransactionsPage({ skip, from, to, locationId });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function main() {
  for (const loc of locations) {
    const first = (await fetchAll(loc)).filter((r) => parseWalletCategory(r.description) === category);
    const second = (await fetchAll(loc)).filter((r) => parseWalletCategory(r.description) === category); // is the response stable?
    const counts = new Map<string, number>();
    for (const r of first) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    const dups = [...counts].filter(([, n]) => n > 1);
    const unique = new Set(counts.keys());
    const stored = await db.walletTransaction.findMany({ where: { settlementTime: { gte: new Date(from), lte: new Date(to) }, category }, select: { id: true, scopeKey: true } });
    const here = new Map(stored.filter((s) => s.scopeKey === loc).map((s) => [s.id, s.scopeKey]));
    const elsewhere = await db.walletTransaction.findMany({ where: { id: { in: [...unique] }, NOT: { scopeKey: loc } }, select: { id: true, scopeKey: true } });
    const elsewhereIds = new Set(elsewhere.map((e) => e.id));
    const missing = [...unique].filter((id) => !here.has(id) && !elsewhereIds.has(id));
    const stale = [...here.keys()].filter((id) => !unique.has(id));
    const sum = (rs: typeof first) => rs.reduce((s, r) => s + Math.round(r.amount * 1e6), 0) / 1e6;

    console.log(`\n=== …${loc.slice(-4)}  ${day} UTC  category ${category} ===`);
    console.log(`GHL response: ${first.length} rows (${sum(first).toFixed(6)})   unique ids: ${unique.size}   second fetch: ${second.length} rows`);
    console.log(`Stored under this scope: ${here.size}`);
    console.log(`Duplicate ids inside the GHL response: ${dups.length}${dups.length ? "  e.g. " + dups.slice(0, 5).map(([id, n]) => `${t6(id)}×${n}`).join(", ") : ""}   → rollup over-count from duplicates = ${first.length - unique.size} rows`);
    console.log(`Unique ids stored under a DIFFERENT scope: ${elsewhere.length}${elsewhere.length ? "  e.g. " + elsewhere.slice(0, 5).map((e) => `${t6(e.id)}→${e.scopeKey.startsWith("_") ? e.scopeKey : "…" + e.scopeKey.slice(-4)}`).join(", ") : ""}`);
    console.log(`Unique ids not stored anywhere: ${missing.length}${missing.length ? "  e.g. " + missing.slice(0, 5).map(t6).join(", ") : ""}`);
    console.log(`Stored here but not returned now: ${stale.length}`);
    const explained = first.length - unique.size + elsewhere.length + missing.length;
    console.log(`Rollup rows − stored rows explained by the above: ${explained}  (rollup counted ${first.length}, table has ${here.size})`);
  }
  console.log("\nRead-only: nothing was written.");
}

main().finally(() => db.$disconnect());
