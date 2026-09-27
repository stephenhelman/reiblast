import Link from "next/link";
import MoneyChart from "@/components/admin/charts";
import { ExportButton, Money, RangeForm } from "@/components/admin/controls";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import { paramsOf, parseRange } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { COST_GROUPS, getCosts, GROUP_LABEL, SCOPE_CLASSES, SCOPE_LABEL, type CostGroup } from "@/lib/billing/reports/costs";
import { fmtMoney, toPlot, sumOf } from "@/lib/billing/reports/money";

export const dynamic = "force-dynamic";

const COLORS: Record<CostGroup, string> = { ongoing: "#5B8DEF", one_time: "#F5C842", agency_cash: "#3FB68B", tax: "#E0704A" };

export default async function CostsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const range = parseRange(paramsOf(searchParams), now);
  const c = await getCosts(db, range, hq);
  const rows = (q: Record<string, string | undefined>) => adminHref(base, "/costs/rows", { ...range, ...q });
  const link = (amount: string, q: Record<string, string | undefined>) => (Number(amount) === 0 ? <span className="text-white/30">—</span> : <Link href={rows(q)} className="text-white hover:text-gold"><Money>{fmtMoney(amount)}</Money></Link>);

  const byCategory = new Map<string, { category: string; group: CostGroup; count: number; display: string[] }>();
  for (const cell of c.rows) {
    const k = cell.category;
    const e = byCategory.get(k) ?? { category: k, group: cell.group, count: 0, display: [] };
    e.count += cell.count;
    e.display.push(cell.display);
    byCategory.set(k, e);
  }
  const cats = [...byCategory.values()].sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub="Wallet charges from GHL, by Denver month of settlement. Costs are shown positive; “agency cash” is what you pay GHL to fund the wallet.">Costs</PageTitle>
        <ExportButton view="costs" params={range} label="Export summary CSV" />
      </div>
      <div className="mt-6"><RangeForm from={range.fromMonth} to={range.toMonth} /></div>

      <Section title="By month" note="One-time: A2P registration/fast track, domains, caller ID. Ongoing: all other usage (SMS, calls, email, AI, phone numbers…). Agency cash: agency auto + manual recharges. Taxes: wallet sales tax. Click a cell for the transactions (raw rows are viewed one month at a time).">
        <MoneyChart
          data={c.byMonth.map((m) => ({ month: m.month, ...Object.fromEntries(COST_GROUPS.map((g) => [g, toPlot(m.byGroup[g])])) }))}
          series={COST_GROUPS.map((g) => ({ key: g, label: GROUP_LABEL[g], color: COLORS[g] }))}
        />
        <Table
          head={["Month", ...COST_GROUPS.map((g) => GROUP_LABEL[g])]}
          rows={[
            ...c.byMonth.map((m) => [m.month, ...COST_GROUPS.map((g) => link(m.byGroup[g], { month: m.month, group: g }))]),
            [<strong key="t">Total</strong>, ...COST_GROUPS.map((g) => <Money key={g}>{fmtMoney(c.totals.byGroup[g])}</Money>)],
          ]}
          empty="No wallet activity in this range."
        />
      </Section>

      <Section title="By scope" note="Members, REIblast HQ, the agency account (blank-name wallet rows) and unattributed rows (named locations that are not members) are kept separate.">
        <Table
          head={["Scope", ...COST_GROUPS.map((g) => GROUP_LABEL[g]), "Total charges"]}
          rows={SCOPE_CLASSES.map((s) => [
            SCOPE_LABEL[s],
            ...COST_GROUPS.map((g) => link(c.byScope[s][g], { scope: s, group: g })),
            <Money key="t">{fmtMoney(sumOf(COST_GROUPS.filter((g) => g !== "agency_cash").map((g) => c.byScope[s][g])))}</Money>,
          ])}
        />
      </Section>

      <Section title="By category" note="Across all scopes in the range.">
        <Table
          head={["Category", "Group", "Transactions", "Amount"]}
          rows={cats.map((k) => [<Link key={k.category} className="hover:text-gold" href={rows({ category: k.category })}>{k.category}</Link>, GROUP_LABEL[k.group], k.count.toLocaleString("en-US"), <Money key="a">{fmtMoney(sumOf(k.display))}</Money>])}
          empty="No wallet activity in this range."
        />
      </Section>
    </div>
  );
}
