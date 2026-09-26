/**
 * Historical wallet usage backfill: monthly windows per location (plus HQ), bucketed by UTC day,
 * replacing per (scopeKey, day). Same lib function the nightly wallet_usage job uses.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/backfill-usage.ts [--from=2026-06-01] [--to=YYYY-MM-DD] [--apply]
 *
 * Default range: 2026-06-01 through yesterday (UTC). Dry-run computes the rollup and prints totals, writing nothing.
 * Refuses the production host.
 */
import { apiStats } from "../../lib/billing/ghlWallet";
import { runWalletUsageWindow } from "../../lib/billing/jobs/walletUsage";
import { listWalletLocations } from "../../lib/billing/jobs/locations";
import { microsToDecimalString, type RollupRow } from "../../lib/billing/usageRollup";
import { arg, connect } from "./_cli";

const { db, apply } = connect();

function monthWindows(fromDay: string, toDay: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let y = +fromDay.slice(0, 4), m = +fromDay.slice(5, 7) - 1;
  const end = Date.parse(`${toDay}T23:59:59.999Z`);
  for (;;) {
    const start = Math.max(Date.UTC(y, m, 1), Date.parse(`${fromDay}T00:00:00.000Z`));
    if (start > end) break;
    const monthEnd = Date.UTC(y, m + 1, 1) - 1;
    out.push({ from: new Date(start).toISOString(), to: new Date(Math.min(monthEnd, end)).toISOString() });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

async function main() {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const fromDay = arg("from") ?? "2026-06-01";
  const toDay = arg("to") ?? yesterday;
  const windows = monthWindows(fromDay, toDay);
  const locs = await listWalletLocations(db);
  console.log(`Range ${fromDay} → ${toDay}: ${windows.length} monthly window(s), ${locs.length} locations (incl. HQ)`);
  console.log(`Estimated GHL API calls: min ${windows.length * (locs.length + 1)} (one per location + one unfiltered per window), typically ~1.7× that once multi-page locations are counted\n`);

  const totals = new Map<string, { count: number; micros: number }>(); // `${scope}|${category}`
  for (const w of windows) {
    const collected = new Map<string, RollupRow[]>();
    const before = apiStats.calls;
    const r = await runWalletUsageWindow(
      { db, apply, cursor: null, now: new Date(), shouldYield: () => false },
      { window: w, onScope: (scope, rows) => collected.set(scope, rows) },
    );
    console.log(`${w.from.slice(0, 10)} → ${w.to.slice(0, 10)}: calls=${apiStats.calls - before} rowsSeen=${(r.summary as any).rowsSeen} unfiltered=${(r.summary as any).unfilteredRows} rollupRows=${(r.summary as any).rollupRows}`);
    for (const [scope, rows] of collected) {
      for (const row of rows) {
        const k = `${scope}|${row.category}`;
        const t = totals.get(k) ?? { count: 0, micros: 0 };
        t.count += row.count;
        t.micros += row.micros;
        totals.set(k, t);
      }
    }
  }
  console.log(`\nTotal GHL API calls: ${apiStats.calls}`);
  console.log("\nScope | category | rows | amount");
  const hq = process.env.GHL_HQ_LOCATION_ID;
  const label = (s: string) => (s === hq ? "HQ" : s.startsWith("_") ? s : "member");
  const byLabel = new Map<string, { count: number; micros: number }>();
  for (const [k, t] of totals) {
    const [scope, cat] = k.split("|");
    const lk = `${label(scope)}|${cat}`;
    const o = byLabel.get(lk) ?? { count: 0, micros: 0 };
    o.count += t.count;
    o.micros += t.micros;
    byLabel.set(lk, o);
  }
  for (const [k, t] of [...byLabel].sort()) console.log(`  ${k.replace("|", " | ").padEnd(46)} ${String(t.count).padStart(6)}  ${microsToDecimalString(t.micros)}`);
  const sum = (pred: (k: string) => boolean) => microsToDecimalString([...byLabel].filter(([k]) => pred(k)).reduce((a, [, t]) => a + t.micros, 0));
  console.log(`\nMember usage total: ${sum((k) => k.startsWith("member|"))}`);
  console.log(`HQ total:           ${sum((k) => k.startsWith("HQ|"))}`);
  console.log(`_agency total:      ${sum((k) => k.startsWith("_agency|"))}`);
  console.log(`_unattributed total: ${sum((k) => k.startsWith("_unattributed|"))}`);
}

main().finally(() => db.$disconnect());
