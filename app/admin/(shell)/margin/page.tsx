import Link from "next/link";
import AccountLabel from "@/components/admin/AccountLabel";
import { ExportButton, Money, RangeForm, SortHeader } from "@/components/admin/controls";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import Card from "@/components/shared/Card";
import { paramsOf, parseMarginSort, parseRange } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { costCells, summarizeCosts, usageByScope } from "@/lib/billing/reports/costs";
import { accountInfo } from "@/lib/billing/reports/labels";
import { buildAgencyMargin, buildMemberMargin, parseFeePct, sortMemberMargin } from "@/lib/billing/reports/margin";
import { fmtMoney } from "@/lib/billing/reports/money";
import { aggregateRevenue, fetchLedgerRows } from "@/lib/billing/reports/revenue";

export const dynamic = "force-dynamic";

export default async function MarginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const range = parseRange(p, now);
  const { sort, dir } = parseMarginSort(p);
  const fee = parseFeePct(process.env.ADMIN_PROCESSOR_FEE_PCT);

  const [ledger, cells, info, usage] = await Promise.all([fetchLedgerRows(db, range), costCells(db, range, hq), accountInfo(db), usageByScope(db, range, hq)]);
  const agency = buildAgencyMargin(aggregateRevenue(ledger, range.fromMonth, range.toMonth).rows, summarizeCosts(cells).byMonth, fee);
  const members = [...info.entries()].map(([accountId, i]) => ({ accountId, locationId: i.locationId }));
  const mm = buildMemberMargin(members, ledger, usage, range);
  const label = (r: { accountId: string }) => { const i = info.get(r.accountId); return `${i?.locationName ?? i?.businessName ?? "Unnamed location"} ${i?.locationId?.slice(-4) ?? ""}`; };
  const sorted = sortMemberMargin(mm.rows, sort, dir, label);
  const keep = { from: range.fromMonth, to: range.toMonth };
  const head = (key: string, text: string) => <SortHeader key={key} base={base} path="/margin" params={keep} sortKey={key} label={text} current={sort} dir={dir} />;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub="Cash view: money collected through GHL versus cash paid to GHL. Not a bank reconciliation.">Margin</PageTitle>
        <div className="flex gap-2">
          <ExportButton view="margin" params={{ ...keep, by: "agency" }} label="Export agency CSV" />
          <ExportButton view="margin" params={{ ...keep, by: "member", sort, dir }} label="Export by-member CSV" />
        </div>
      </div>
      <div className="mt-6"><RangeForm from={range.fromMonth} to={range.toMonth} /></div>

      <Section
        title="Agency cash margin"
        note={`Gross cash margin = net revenue collected − agency recharges paid to GHL (auto + manual) − wallet sales tax. Net revenue uses the Revenue rule; costs are by Denver month of settlement. Processor fees, chargebacks and payouts are not in the data.${fee ? ` The fee line is an ESTIMATE at ${fee}% of net revenue (ADMIN_PROCESSOR_FEE_PCT).` : ""}`}
      >
        <Table
          head={["Month", "Net revenue collected", "Agency cash paid to GHL", "Wallet sales tax", "Gross cash margin", ...(fee ? ["Processor fees (estimate)", "Margin after fees (estimate)"] : [])]}
          rows={[
            ...agency.rows.map((r) => [
              <Link key={r.month} className="hover:text-gold" href={adminHref(base, "/revenue", { from: r.month, to: r.month })}>{r.month}</Link>,
              <Money key="n">{fmtMoney(r.netRevenue)}</Money>,
              <Link key="c" className="hover:text-gold" href={adminHref(base, "/costs/rows", { ...keep, month: r.month, group: "agency_cash" })}><Money>{fmtMoney(r.agencyCash)}</Money></Link>,
              <Link key="t" className="hover:text-gold" href={adminHref(base, "/costs/rows", { ...keep, month: r.month, group: "tax" })}><Money>{fmtMoney(r.tax)}</Money></Link>,
              <strong key="m"><Money neg={Number(r.margin) < 0}>{fmtMoney(r.margin)}</Money></strong>,
              ...(fee ? [<span key="f" className="italic text-white/60">{fmtMoney(r.feeEstimate)}</span>, <span key="a" className="italic text-white/60">{fmtMoney(r.marginAfterFeeEstimate)}</span>] : []),
            ]),
            [<strong key="t">Total</strong>, <Money key="n">{fmtMoney(agency.totals.netRevenue)}</Money>, <Money key="c">{fmtMoney(agency.totals.agencyCash)}</Money>, <Money key="x">{fmtMoney(agency.totals.tax)}</Money>, <strong key="m"><Money neg={Number(agency.totals.margin) < 0}>{fmtMoney(agency.totals.margin)}</Money></strong>, ...(fee ? [<span key="f" className="italic text-white/60">{fmtMoney(agency.totals.feeEstimate)}</span>, <span key="a" className="italic text-white/60">{fmtMoney(agency.totals.marginAfterFeeEstimate)}</span>] : [])],
          ]}
        />
      </Section>

      <div className="mt-8">
        <Card>
          <h2 className="text-lg font-bold text-white">Partner split</h2>
          <p className="mt-1 text-sm text-white/50">Formula pending.</p>
        </Card>
      </div>

      <Section title="Per member" note="Wallet recharges + core subscription collected (net of refunds) versus wallet usage charged, over the selected months. Ledger rows with no account are the Unmatched line. HQ and the internal owner account are not members.">
        <Table
          head={[head("label", "Member"), head("recharges", "Wallet recharges"), head("core", "Core subscription"), "Other", head("collected", "Total collected"), head("usage", "Usage charged"), head("net", "Member net")]}
          rows={[
            ...sorted.map((r) => {
              const i = info.get(r.accountId);
              return [
                <Link key="a" href={adminHref(base, `/members/${r.accountId}`, keep)} className="hover:text-gold"><AccountLabel locationId={i?.locationId} locationName={i?.locationName} businessName={i?.businessName} /></Link>,
                <Money key="r">{fmtMoney(r.recharges)}</Money>,
                <Money key="c">{fmtMoney(r.core)}</Money>,
                <Money key="o">{fmtMoney(r.other)}</Money>,
                <Money key="t">{fmtMoney(r.collected)}</Money>,
                <Money key="u">{fmtMoney(r.usage)}</Money>,
                <strong key="n"><Money neg={Number(r.net) < 0}>{fmtMoney(r.net)}</Money></strong>,
              ];
            }),
            [<span key="a" className="italic text-white/70">Unmatched (ledger rows with no account)</span>, <Money key="r">{fmtMoney(mm.unmatched.recharges)}</Money>, <Money key="c">{fmtMoney(mm.unmatched.core)}</Money>, <Money key="o">{fmtMoney(mm.unmatched.other)}</Money>, <Money key="t">{fmtMoney(mm.unmatched.collected)}</Money>, "—", <Money key="n">{fmtMoney(mm.unmatched.collected)}</Money>],
            [<strong key="a">Total</strong>, <Money key="r">{fmtMoney(mm.totals.recharges)}</Money>, <Money key="c">{fmtMoney(mm.totals.core)}</Money>, <Money key="o">{fmtMoney(mm.totals.other)}</Money>, <Money key="t">{fmtMoney(mm.totals.collected)}</Money>, <Money key="u">{fmtMoney(mm.totals.usage)}</Money>, <strong key="n"><Money neg={Number(mm.totals.net) < 0}>{fmtMoney(mm.totals.net)}</Money></strong>],
          ]}
        />
      </Section>
    </div>
  );
}
