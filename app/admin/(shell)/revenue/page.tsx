import Link from "next/link";
import MoneyChart from "@/components/admin/charts";
import { ExportButton, Money, RangeForm } from "@/components/admin/controls";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import { paramsOf, parseRange } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { fmtDenverDate } from "@/lib/admin/format";
import { fmtMoney, toPlot } from "@/lib/billing/reports/money";
import { aggregateAttempts, aggregateRevenue, CLASS_LABEL, eraMonths, fetchEras, fetchLedgerRows, providerLabel, REVENUE_CLASS_KEYS } from "@/lib/billing/reports/revenue";

export const dynamic = "force-dynamic";

const COLORS = { core_subscription: "#F5C842", wallet_auto_recharge: "#5B8DEF", wallet_manual_recharge: "#3FB68B", other: "#888888" } as const;

export default async function RevenuePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, now } = await pageCtx();
  const range = parseRange(paramsOf(searchParams), now);
  const [ledger, eras] = await Promise.all([fetchLedgerRows(db, range), fetchEras(db)]);
  const rev = aggregateRevenue(ledger, range.fromMonth, range.toMonth);
  const att = aggregateAttempts(ledger, range);
  const rows = (q: Record<string, string | undefined>) => adminHref(base, "/revenue/rows", { ...range, ...q });
  const cell = (n: string, count: number, href: string) => (count === 0 ? <span className="text-white/30">—</span> : <Link href={href} className="text-white hover:text-gold"><Money neg={Number(n) < 0}>{fmtMoney(n)}</Money> <span className="text-xs text-white/40">({count})</span></Link>);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub="Net revenue collected through GHL, by Denver month. Succeeded and refunded payments, net of refunds.">Revenue</PageTitle>
        <div className="flex gap-2">
          <ExportButton view="revenue" params={range} label="Export summary CSV" />
          <ExportButton view="revenue" params={{ ...range, detail: 1 }} label="Export all rows CSV" />
        </div>
      </div>
      <div className="mt-6"><RangeForm from={range.fromMonth} to={range.toMonth} /></div>

      <Section title="Net revenue by month" note="Refunds are attributed to the original transaction’s month. Failed, pending, $0 trial authorizations and failed signups are not revenue (see Attempts). Every cell opens the underlying ledger rows.">
        <MoneyChart
          data={rev.rows.map((m) => ({ month: m.month, ...Object.fromEntries(REVENUE_CLASS_KEYS.map((k) => [k, toPlot(m.byClass[k].net)])) }))}
          series={REVENUE_CLASS_KEYS.map((k) => ({ key: k, label: CLASS_LABEL[k], color: COLORS[k] }))}
        />
        <Table
          head={["Month", ...REVENUE_CLASS_KEYS.map((k) => CLASS_LABEL[k]), "Net revenue", "Processor(s)"]}
          rows={[
            ...rev.rows.map((m) => [
              m.month,
              ...REVENUE_CLASS_KEYS.map((k) => cell(m.byClass[k].net, m.byClass[k].count, rows({ month: m.month, class: k }))),
              cell(m.net, m.count, rows({ month: m.month })),
              eraMonths(m).map(providerLabel).join(", ") || "—",
            ]),
            [<strong key="t">Total</strong>, ...REVENUE_CLASS_KEYS.map((k) => cell(rev.totals.byClass[k].net, rev.totals.byClass[k].count, rows({ class: k }))), cell(rev.totals.net, rev.totals.count, rows({})), ""],
          ]}
        />
      </Section>

      <Section title="Processor eras" note="Which GHL payment processor handled each transaction, from the provider on every ledger row (whole ledger, not just this range). Provider names are GHL’s processors, unrelated to the REItools Stripe integration.">
        <Table
          head={["Processor", "First transaction", "Last transaction", "Ledger rows"]}
          rows={eras.map((e) => [<Link key={e.provider} className="hover:text-gold" href={rows({ provider: e.provider })}>{e.label}</Link>, fmtDenverDate(e.first), fmtDenverDate(e.last), e.count])}
        />
      </Section>

      <Section title="Attempts (not revenue)" note="Everything that is not counted above: failed and pending payments, $0 trial authorizations and failed signups. Amount is the gross amount attempted.">
        <div className="flex justify-end px-4 pt-3 gap-2">
          <ExportButton view="attempts" params={range} label="Export summary CSV" />
          <ExportButton view="attempts" params={{ ...range, detail: 1 }} label="Export all rows CSV" />
        </div>
        <Table
          head={["Class", "Status", "Count", "Gross attempted"]}
          rows={[
            ...att.rows.map((c) => [c.classification, c.status, <Link key="n" className="hover:text-gold" href={rows({ view: "attempts", classification: c.classification, status: c.status })}>{c.count}</Link>, <Money key="a">{fmtMoney(c.amount)}</Money>]),
            [<strong key="t">Total</strong>, "", <Link key="n" className="hover:text-gold" href={rows({ view: "attempts" })}>{att.totals.count}</Link>, <Money key="a">{fmtMoney(att.totals.amount)}</Money>],
          ]}
          empty="No attempts in this range."
        />
      </Section>
    </div>
  );
}
