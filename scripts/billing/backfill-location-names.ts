/**
 * One-time fill of GhlAccount.locationName for member accounts. Read-only against GHL; writes only with --apply.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/backfill-location-names.ts            # dry-run: prints the call plan, then fetches and reports
 *   PRISMA_TARGET=dev npx tsx scripts/billing/backfill-location-names.ts --apply    # also writes locationName / locationNameUpdatedAt
 *   … --refresh   # include accounts that already have a name (default: only null names)
 *
 * WalletTransaction does not store locationName, so per location with wallet rows: one single-day wallet pull (the UTC day of
 * its latest WalletTransaction) and read the name from the rows. Locations still without a name (no wallet rows, or rows
 * carried no name) get GET /locations/{id} with the agency key. Anything still blank stays null. Refuses the production host.
 */
import { apiStats, getLocationName, GhlScopeError, walletTransactionsPage } from "../../lib/billing/ghlWallet";
import { latestLocationName } from "../../lib/billing/usageRollup";
import { connect } from "./_cli";

const { db, apply } = connect();
const refresh = process.argv.includes("--refresh");
const last4 = (s: string) => `…${s.slice(-4)}`;
const peek = (s: string) => `"${s.slice(0, 3)}…" (${s.length} chars)`;

async function main() {
  const members = await db.ghlAccount.findMany({
    where: { accountType: "member", locationId: { not: null } },
    select: { id: true, locationId: true, locationName: true, user: { select: { businessName: true } } },
  });
  const todo = members.filter((m) => refresh || !m.locationName);
  const ids = todo.map((m) => m.locationId as string);
  const latest = ids.length
    ? await db.$queryRaw<{ scopeKey: string; latest: Date }[]>`SELECT "scopeKey", MAX("settlementTime") AS latest FROM "WalletTransaction" WHERE "scopeKey" = ANY(${ids}) GROUP BY 1`
    : [];
  const latestBy = new Map(latest.map((r) => [r.scopeKey, r.latest]));
  const withWallet = todo.filter((m) => latestBy.has(m.locationId as string));
  const noWallet = todo.length - withWallet.length;

  console.log(`Member accounts with a locationId: ${members.length} (already named: ${members.length - todo.length}${refresh ? ", but --refresh includes them" : ""})`);
  console.log(`To fill: ${todo.length}`);
  console.log("\nCALL PLAN (before any GHL call):");
  console.log(`  wallet pulls (1 per location with wallet rows): ${withWallet.length}`);
  console.log(`  GET /locations/{id} for locations with no wallet rows: ${noWallet}`);
  console.log(`  + up to ${withWallet.length} more GET /locations/{id} if a wallet day carries no usable name`);
  console.log(`  => between ${withWallet.length + noWallet} and ${withWallet.length * 2 + noWallet} read-only GHL calls\n`);

  const found = new Map<string, { name: string; source: "wallet" | "location GET" }>();
  for (const m of withWallet) {
    const loc = m.locationId as string;
    const day = (latestBy.get(loc) as Date).toISOString().slice(0, 10);
    const rows = await walletTransactionsPage({ skip: 0, from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z`, locationId: loc, limit: 50 });
    const seen = latestLocationName(null, rows);
    if (seen) found.set(loc, { name: seen.name, source: "wallet" });
  }
  const getFailures: Record<string, number> = {};
  for (const m of todo) {
    const loc = m.locationId as string;
    if (found.has(loc)) continue;
    try {
      const name = await getLocationName(loc);
      if (name) found.set(loc, { name, source: "location GET" });
      else getFailures["readable but no name"] = (getFailures["readable but no name"] ?? 0) + 1;
    } catch (err) {
      // 401/403 (agency key can't read this location) or anything else: leave null and keep going.
      const why = err instanceof GhlScopeError ? err.message.replace(/ on GET.*/, "") : "error";
      getFailures[why] = (getFailures[why] ?? 0) + 1;
    }
  }

  const fromWallet = [...found.values()].filter((f) => f.source === "wallet").length;
  const fromGet = found.size - fromWallet;
  const stillNull = todo.filter((m) => !found.has(m.locationId as string));
  console.log(`GHL calls made: ${apiStats.calls}`);
  console.log(`Named from wallet data:   ${fromWallet}`);
  console.log(`Named from GET /locations: ${fromGet}`);
  console.log(`Remain null:              ${stillNull.length}`);
  console.log(`  GET /locations failures by reason:`, getFailures);
  for (const m of stillNull) console.log(`  ${last4(m.locationId as string)} — label falls back to ${m.user?.businessName ? "User.businessName" : '"Unnamed location"'}`);
  console.log("\nSample (masked):");
  for (const [loc, f] of [...found].slice(0, 8)) console.log(`  ${last4(loc)}  ${peek(f.name)}  via ${f.source}`);

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply.");
    return;
  }
  const now = new Date();
  let written = 0;
  for (const m of todo) {
    const f = found.get(m.locationId as string);
    if (!f) continue;
    const r = await db.ghlAccount.updateMany({ where: { id: m.id, accountType: "member", ...(refresh ? {} : { locationName: null }) }, data: { locationName: f.name, locationNameUpdatedAt: now } });
    written += r.count;
  }
  console.log(`\nWrote locationName on ${written} accounts.`);
}

main().finally(() => db.$disconnect());
