import Link from "next/link";
import { notFound } from "next/navigation";
import MoneyChart from "@/components/admin/charts";
import AccountLabel from "@/components/admin/AccountLabel";
import { ExportButton, Mono, Money, Pager, RangeForm } from "@/components/admin/controls";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import Card from "@/components/shared/Card";
import { fmtDenver, fmtDenverDate } from "@/lib/admin/format";
import { paramsOf, parseCostFilters, parseCursor, parseRange } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { costDetailPage, costGroupOf, GROUP_LABEL } from "@/lib/billing/reports/costs";
import { monthsBetween } from "@/lib/billing/reports/denver";
import { fmtMoney, sumOf, toPlot } from "@/lib/billing/reports/money";
import { getMemberDetail } from "@/lib/billing/reports/members";
import { CLASS_LABEL, isRevenue, netOf, providerLabel, refundNote, revenueClassOf } from "@/lib/billing/reports/revenue";

export const dynamic = "force-dynamic";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-sm text-white">{children}</div>
    </div>
  );
}

export default async function MemberPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const range = parseRange(p, now);
  const detail = await getMemberDetail(db, params.id, range, hq, now);
  if (!detail) notFound();
  const { member: m, ledger, monthlyCategories, chart, snapshots } = detail;

  const cursor = parseCursor(p);
  const cf = parseCostFilters(p, now);
  const walletFilters = { ...range, month: cf.month, scopeKey: m.locationId ?? "__none__" };
  const wallet = m.locationId ? await costDetailPage(db, walletFilters, hq, cursor) : { rows: [], nextCursor: null };
  const months = monthsBetween(range.fromMonth, range.toMonth);
  const cats = [...new Set(monthlyCategories.cells.map((c) => c.category))].sort();
  const cellOf = (cat: string, month: string) => sumOf(monthlyCategories.cells.filter((c) => c.category === cat && c.month === month).map((c) => c.display));
  const keep = { from: range.fromMonth, to: range.toMonth };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub={m.locationId ? `Location …${m.locationId.slice(-4)}` : "No location yet"}>
          <AccountLabel locationId={m.locationId} locationName={m.locationName} businessName={m.businessName} />
        </PageTitle>
        <div className="flex gap-2">
          <ExportButton view="member-ledger" params={{ member: m.accountId }} label="Export ledger CSV" />
          <Link href={adminHref(base, "/members")} className="text-sm text-gold hover:underline">← All members</Link>
        </div>
      </div>

      <Card className="mt-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Fact label="Billing state">{m.billingState ?? <span className="text-gold">not seeded</span>}</Fact>
          <Fact label="Pause reason">{m.pauseReason?.replace("_", " ") ?? "—"}</Fact>
          <Fact label="Legacy unreconciled">{m.legacyUnreconciled ? "yes" : "no"}</Fact>
          <Fact label="Strikes (live, pre-cutover)">{m.strikes}</Fact>
          <Fact label="Covered until">{m.coveredUntil ? fmtDenverDate(m.coveredUntil) : "—"}{m.coverageNote && <span className="block text-xs text-white/40">{m.coverageNote}</span>}</Fact>
          <Fact label="Expected next charge (≈ estimate)">
            {m.expectedNextCharge ? `≈ ${fmtDenverDate(m.expectedNextCharge)}` : "—"}
            {m.coverageOverrideApplies && <span className="ml-2 rounded border border-gold/50 px-1.5 text-xs text-gold">override applies</span>}
          </Fact>
          <Fact label="Last core payment">{m.lastCorePaymentAt ? fmtDenverDate(m.lastCorePaymentAt) : "—"}</Fact>
          <Fact label="Latest balance">{m.balance ? (m.balance.status === "ok" ? fmtMoney(m.balance.balance) : m.balance.status) : "—"}</Fact>
          <Fact label="Trial offer">{m.trialOffer ?? "—"}</Fact>
          <Fact label="Trial ends">{m.trialEndsAt ? fmtDenverDate(m.trialEndsAt) : "—"}</Fact>
          <Fact label="30-day usage">{fmtMoney(m.usage30)}</Fact>
          <Fact label="30-day recharges">{fmtMoney(m.recharges30)}</Fact>
        </div>
        <p className="mt-4 text-xs text-white/40">
          Expected next charge is latest succeeded core payment + 1 month — an estimate, not a billing date. Covered until is the manual override and ends at 00:00 Denver on that date.
        </p>
      </Card>

      <div className="mt-6"><RangeForm from={range.fromMonth} to={range.toMonth} hidden={{}} /></div>

      <Section title="Revenue vs usage" note="Net revenue collected (revenue rule) versus wallet usage charged, by Denver month.">
        <MoneyChart
          data={chart.map((c) => ({ month: c.month, revenue: toPlot(c.revenue), usage: toPlot(c.usage) }))}
          series={[{ key: "revenue", label: "Revenue collected", color: "#3FB68B" }, { key: "usage", label: "Usage charged", color: "#E0704A" }]}
          stacked={false}
          height={220}
        />
        <Table head={["Month", "Revenue", "Usage", "Net"]} rows={chart.map((c) => [c.month, <Money key="r">{fmtMoney(c.revenue)}</Money>, <Money key="u">{fmtMoney(c.usage)}</Money>, <Money key="n" neg={Number(c.net) < 0}>{fmtMoney(c.net)}</Money>])} />
      </Section>

      <Section title="Ledger rows" note="Every payment on this account, all statuses. Refunds are attributed to the original transaction’s month.">
        <Table
          head={["GHL transaction", "Date (Denver)", "Class", "Status", "Amount", "Refunded", "Net", "Provider"]}
          rows={ledger.map((r) => [
            <Mono key="i">{r.ghlTransactionId}</Mono>,
            fmtDenver(r.occurredAt),
            isRevenue(r) ? CLASS_LABEL[revenueClassOf(r.classification)] : r.classification,
            r.status,
            <Money key="a">{fmtMoney(r.amount)}</Money>,
            Number(r.amountRefunded) === 0 ? "—" : <span key="f"><Money>{fmtMoney(r.amountRefunded)}</Money> <span className="text-xs text-white/40">{refundNote(r)}</span></span>,
            isRevenue(r) ? <Money key="n">{fmtMoney(netOf(r))}</Money> : <span key="n" className="text-white/30">not revenue</span>,
            providerLabel(r.provider),
          ])}
          empty="No ledger rows."
        />
      </Section>

      <Section title="Monthly usage by category" note="Wallet charges by Denver month (positive = cost). Export the raw transactions for one month at a time.">
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {months.map((mo) => (
            <span key={mo} className="flex items-center gap-1 text-xs text-white/50">
              {mo} <ExportButton view="member-usage" params={{ member: m.accountId, month: mo }} label="CSV" />
            </span>
          ))}
        </div>
        <Table head={["Category", ...months]} rows={[...cats.map((c) => [c, ...months.map((mo) => <Money key={mo}>{fmtMoney(cellOf(c, mo))}</Money>)]), [<strong key="t">Total</strong>, ...months.map((mo) => <Money key={mo}>{fmtMoney(sumOf(monthlyCategories.cells.filter((c) => c.month === mo).map((c) => c.display)))}</Money>)]]} empty="No wallet activity." />
      </Section>

      <Section title="Recent wallet transactions" note={cf.month ? `Month ${cf.month} (Denver).` : `Newest first across ${range.fromMonth} – ${range.toMonth}.`}>
        <Table
          head={["Wallet transaction", "Settled (Denver)", "Category", "Description", "Amount"]}
          rows={wallet.rows.map((w) => [<Mono key="i">{w.id}</Mono>, fmtDenver(w.settlementTime), <span key="c">{w.category} <span className="text-xs text-white/40">{GROUP_LABEL[costGroupOf(w.category)]}</span></span>, <span key="d" className="text-white/60">{w.description}</span>, <Money key="a" neg={Number(w.amount) < 0}>{fmtMoney(w.amount, 6)}</Money>])}
          empty="No transactions."
        />
        <Pager base={base} path={`/members/${m.accountId}`} params={{ ...keep, month: cf.month, after: cursor ?? undefined }} nextCursor={wallet.nextCursor} shown={wallet.rows.length} />
      </Section>

      <Section title="Balance history" note="Daily wallet balance snapshots (latest 90).">
        <Table head={["Day", "Status", "Balance"]} rows={snapshots.map((s) => [s.takenOn, s.status, s.balance === null ? "—" : <Money key="b" neg={Number(s.balance) < 0}>{fmtMoney(s.balance)}</Money>])} empty="No snapshots." />
      </Section>
    </div>
  );
}
