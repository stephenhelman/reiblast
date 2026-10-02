import Link from "next/link";
import AccountLabel from "@/components/admin/AccountLabel";
import Card from "@/components/shared/Card";
import { adminHref } from "@/lib/admin/links";
import { addMonths, currentDenverMonth } from "@/lib/billing/reports/denver";
import { costCells, summarizeCosts } from "@/lib/billing/reports/costs";
import { buildAgencyMargin, parseFeePct } from "@/lib/billing/reports/margin";
import { fmtMoney, sub } from "@/lib/billing/reports/money";
import { aggregateRevenue, fetchLedgerRows } from "@/lib/billing/reports/revenue";
import { adminBase } from "@/lib/admin/cookie";
import { BadgeRow, PageTitle, Section, Table } from "@/components/admin/ui";
import { fmtUsd } from "@/lib/admin/format";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";
import { getBillingDb } from "@/lib/billing/db";
import { buildBadges, getBalancesHealth, getDataQuality, getDbSize, getInactiveUsage, getJobsHealth, getMemberOverview } from "@/lib/billing/reports/health";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireOwnerOrRedirect();
  const db = await getBillingDb();
  const base = await adminBase();
  const hq = process.env.GHL_HQ_LOCATION_ID ?? null;
  const thisMonth = currentDenverMonth();
  const lastMonth = addMonths(thisMonth, -1);
  const twoMonths = { fromMonth: lastMonth, toMonth: thisMonth };
  const [ledger2, cells2] = await Promise.all([fetchLedgerRows(db, twoMonths), costCells(db, twoMonths, hq)]);
  const rev2 = aggregateRevenue(ledger2, lastMonth, thisMonth).rows;
  const margin2 = buildAgencyMargin(rev2, summarizeCosts(cells2).byMonth, parseFeePct(process.env.ADMIN_PROCESSOR_FEE_PCT)).rows;
  const cur = margin2.find((m) => m.month === thisMonth)!;
  const prev = margin2.find((m) => m.month === lastMonth)!;
  const [jobs, quality, balances, dbSize, members, inactiveUsage] = await Promise.all([getJobsHealth(db), getDataQuality(db), getBalancesHealth(db), getDbSize(db), getMemberOverview(db), getInactiveUsage(db)]);
  const badges = buildBadges({ jobs, quality, balances, inactiveUsage, db: dbSize });
  // Negative balances on trial / active / payment_failed (warning) and paused (info); most negative first.
  const negatives = balances.alerts.filter((a) => a.level === "warning" || a.level === "info");

  return (
    <div>
      <PageTitle sub="REIblast billing — health at a glance. Member accounts only; the internal owner account is excluded.">Overview</PageTitle>
      <div className="mt-6">
        <BadgeRow badges={badges} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link href={adminHref(base, "/revenue", { from: lastMonth, to: thisMonth })}>
          <Card className="h-full transition-colors hover:border-gold">
            <div className="text-xs uppercase tracking-wide text-white/40">Net revenue — {thisMonth}</div>
            <div className="mt-2 text-2xl font-bold text-white">{fmtMoney(cur.netRevenue)}</div>
            <div className="mt-1 text-sm text-white/50">{lastMonth}: {fmtMoney(prev.netRevenue)} · change {fmtMoney(sub(cur.netRevenue, prev.netRevenue))}</div>
          </Card>
        </Link>
        <Link href={adminHref(base, "/costs/rows", { month: thisMonth, group: "agency_cash", from: lastMonth, to: thisMonth })}>
          <Card className="h-full transition-colors hover:border-gold">
            <div className="text-xs uppercase tracking-wide text-white/40">Agency cash paid to GHL — {thisMonth}</div>
            <div className="mt-2 text-2xl font-bold text-white">{fmtMoney(cur.agencyCash)}</div>
            <div className="mt-1 text-sm text-white/50">{lastMonth}: {fmtMoney(prev.agencyCash)}</div>
          </Card>
        </Link>
        <Link href={adminHref(base, "/margin", { from: lastMonth, to: thisMonth })}>
          <Card className="h-full transition-colors hover:border-gold">
            <div className="text-xs uppercase tracking-wide text-white/40">Gross cash margin — {thisMonth}</div>
            <div className={`mt-2 text-2xl font-bold ${Number(cur.margin) < 0 ? "text-red-300" : "text-white"}`}>{fmtMoney(cur.margin)}</div>
            <div className="mt-1 text-sm text-white/50">{lastMonth}: {fmtMoney(prev.margin)} · after agency recharges and wallet tax</div>
          </Card>
        </Link>
      </div>
      <p className="mt-2 text-xs text-white/40">Month-to-date, America/Denver. Gross collected via GHL — processor fees, chargebacks and payouts not included.</p>

      <Section title="Members by billing state" note={`${members.memberTotal} member accounts. “Not yet seeded” = billingState is still null.`}>
        <Table head={["Billing state", "Accounts"]} rows={members.billingStates.map((s) => [<Link key={s.state} className="hover:text-gold" href={adminHref(base, "/members", { state: s.state === "not yet seeded" ? "not_seeded" : s.state })}>{s.state}</Link>, s.count])} empty="No member accounts." />
      </Section>

      <Section title="Negative wallet balances" note={`Trial, active, payment_failed and paused accounts only${negatives.length > 10 ? ` — most negative 10 of ${negatives.length}` : ""}. Full alert list on Health.`}>
        <Table
          head={["Location", "State", "Balance", "Snapshot day"]}
          rows={negatives.slice(0, 10).map((r) => [<AccountLabel key={r.accountId} locationId={r.locationId} locationName={r.locationName} businessName={r.businessName} />, r.billingState ?? "—", fmtUsd(r.balance as string), r.takenOn])}
          empty="None."
        />
      </Section>

      <Section title="Legacy" note="Accounts flagged legacyUnreconciled (billing history not yet reconciled).">
        <p className="px-6 py-4 text-sm text-white/80">{members.legacyUnreconciled} member accounts</p>
      </Section>

      <Section title="Strikes — live (pre-cutover)" note="From User.warningCount, the value the running app enforces today. Only users with at least one strike are listed.">
        <Table head={["Strikes", "Users"]} rows={members.strikeCounts.map((s) => [s.warningCount, s.users])} empty="No users with strikes." />
      </Section>
    </div>
  );
}
