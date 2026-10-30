/**
 * READ-ONLY. Compares BillingLedgerEntry row counts per Denver day against a fresh GHL List Transactions pull for the
 * same range, and lists transaction ids present on only one side. Writes nothing anywhere (no ingest, no DB writes).
 *
 *   DATABASE_URL=<non-prod> npx tsx scripts/billing/check-ledger-completeness.ts --from=2026-10-01 --to=2026-10-29
 *
 * Test-mode rows (which ingest ignores) are excluded from the GHL side so the two are comparable.
 */
import { classify } from "../../lib/billing/classify";
import { listTransactionsPage } from "../../lib/billing/ghlTransactions";
import { normalizeTransaction } from "../../lib/billing/normalizeTransaction";
import { denverDayOf, denverDayStart } from "../../lib/billing/reports/denver";
import { arg, connect } from "./_cli";

const from = arg("from"), to = arg("to");
if (!from || !to) throw new Error("usage: --from=YYYY-MM-DD --to=YYYY-MM-DD (Denver days, inclusive)");
const { db } = await connect();

async function main() {
  // Pad the API window by a day on each side (createdAt vs occurredAt can straddle midnight); bucket and trim locally.
  const pad = (d: string, n: number) => new Date(denverDayStart(d).getTime() + n * 864e5).toISOString();
  const startAt = pad(from!, -1), endAt = pad(to!, 2);
  const ghl = new Map<string, string>(); // id → denver day
  let ignored = 0, pages = 0, reported: number | null = null;
  for (let offset = 0; pages < 200; pages++) {
    const page = await listTransactionsPage({ offset, limit: 100, startAt, endAt });
    reported = page.totalCount ?? reported;
    if (!page.data.length) break;
    for (const rec of page.data) {
      const t = normalizeTransaction(rec);
      if (classify(t).classification === "ignore") { ignored++; continue; }
      ghl.set(t.id, denverDayOf(t.occurredAt));
    }
    offset += page.data.length;
    if (page.data.length < 100) break;
  }
  const inRange = (d: string) => d >= from! && d <= to!;

  const rows = await db.billingLedgerEntry.findMany({ where: { occurredAt: { gte: new Date(startAt), lt: new Date(endAt) } }, select: { ghlTransactionId: true, occurredAt: true } });
  const led = new Map(rows.map((r) => [r.ghlTransactionId, denverDayOf(r.occurredAt)]));

  const count = (m: Map<string, string>) => { const c = new Map<string, number>(); for (const d of m.values()) if (inRange(d)) c.set(d, (c.get(d) ?? 0) + 1); return c; };
  const g = count(ghl), l = count(led);
  const days = [...new Set([...g.keys(), ...l.keys()])].sort();
  console.log(`GHL pages: ${pages + 1}  reported totalCount (padded window): ${reported}  test-mode skipped: ${ignored}\n`);
  console.log("day         ghl  ledger  diff");
  let tg = 0, tl = 0, diffDays = 0;
  for (const d of days) {
    const a = g.get(d) ?? 0, b = l.get(d) ?? 0;
    tg += a; tl += b;
    if (a !== b) diffDays++;
    console.log(`${d}  ${String(a).padStart(4)}  ${String(b).padStart(6)}  ${a === b ? "" : String(b - a).padStart(4) + "  <-- DIFFERS"}`);
  }
  console.log(`\nTotal ghl ${tg}  ledger ${tl}  days differing: ${diffDays}`);
  const onlyGhl = [...ghl].filter(([id, d]) => inRange(d) && !led.has(id)), onlyLed = [...led].filter(([id, d]) => inRange(d) && !ghl.has(id));
  console.log(`In GHL but not ledger: ${onlyGhl.length}${onlyGhl.length ? "\n  " + onlyGhl.slice(0, 30).map(([id, d]) => `${d} ${id}`).join("\n  ") : ""}`);
  console.log(`In ledger but not GHL pull: ${onlyLed.length}${onlyLed.length ? "\n  " + onlyLed.slice(0, 30).map(([id, d]) => `${d} ${id}`).join("\n  ") : ""}`);
}

main().finally(() => db.$disconnect());
