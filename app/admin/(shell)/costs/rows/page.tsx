import Link from "next/link";
import { ExportButton, Mono, Money, Pager } from "@/components/admin/controls";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import { definedOnly, paramsOf, parseCostFilters, parseCursor } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { fmtDenver } from "@/lib/admin/format";
import { pageCtx } from "@/lib/admin/pageCtx";
import { costDetailPage, costGroupOf, GROUP_LABEL } from "@/lib/billing/reports/costs";
import { addMonths, currentDenverMonth, monthsBetween } from "@/lib/billing/reports/denver";
import { accountInfo, scopeLabelOf } from "@/lib/billing/reports/labels";
import { fmtMoney } from "@/lib/billing/reports/money";

export const dynamic = "force-dynamic";

/** Drill-down: raw WalletTransaction rows for a filter, one Denver month at a time, newest first, cursor-paginated. */
export default async function CostRowsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const f = parseCostFilters(p, now);
  const cursor = parseCursor(p);
  const filters = definedOnly(f);
  const cur = currentDenverMonth(now);

  if (!f.month) {
    const months = monthsBetween(f.fromMonth, f.toMonth).reverse();
    return (
      <div>
        <PageTitle sub="Raw wallet transactions are viewed and exported one Denver month at a time. Pick a month.">Costs — rows</PageTitle>
        <div className="mt-6 flex flex-wrap gap-2">
          {months.map((m) => (
            <Link key={m} href={adminHref(base, "/costs/rows", { ...filters, month: m })} className="rounded-lg border border-border-default px-3 py-1.5 text-sm text-white/80 hover:border-gold hover:text-gold">{m}</Link>
          ))}
        </div>
        <p className="mt-6 text-sm text-white/50">Filters: {Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(" · ") || "none"} · <Link className="text-gold hover:underline" href={adminHref(base, "/costs", { from: f.fromMonth, to: f.toMonth })}>back to summary</Link> · latest month {cur}</p>
      </div>
    );
  }

  const [page, info] = await Promise.all([costDetailPage(db, f, hq, cursor), accountInfo(db)]);
  const labelOf = scopeLabelOf(info, hq);
  const monthLinks = [addMonths(f.month, -1), addMonths(f.month, 1)].filter((m) => m >= f.fromMonth && m <= cur);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub={`Raw wallet transactions, ${f.month} (Denver), newest first. Amounts are signed as stored: charges negative, recharges positive.`}>Costs — rows</PageTitle>
        <ExportButton view="costs" params={{ ...filters, detail: 1 }} label="Export this month’s raw rows CSV" />
      </div>
      <p className="mt-3 text-sm text-white/60">
        Filters: {Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(" · ")} · <Link className="text-gold hover:underline" href={adminHref(base, "/costs", { from: f.fromMonth, to: f.toMonth })}>back to summary</Link>
        {monthLinks.map((m) => <span key={m}> · <Link className="text-gold hover:underline" href={adminHref(base, "/costs/rows", { ...filters, month: m })}>{m}</Link></span>)}
      </p>
      <Section title="Wallet transactions">
        <Table
          head={["Wallet transaction", "Settled (Denver)", "Scope", "Category", "Description", "Amount"]}
          rows={page.rows.map((w) => {
            const l = labelOf(w.scopeKey);
            return [
              <Mono key="id">{w.id}</Mono>,
              fmtDenver(w.settlementTime),
              <span key="s">{l.name}{l.suffix && <span className="ml-2 text-xs text-white/40">{l.suffix}</span>}</span>,
              <span key="c">{w.category} <span className="text-xs text-white/40">{GROUP_LABEL[costGroupOf(w.category)]}</span></span>,
              <span key="d" className="text-white/60">{w.description}</span>,
              <Money key="m" neg={Number(w.amount) < 0}>{fmtMoney(w.amount, 6)}</Money>,
            ];
          })}
          empty="No transactions match."
        />
        <Pager base={base} path="/costs/rows" params={{ ...filters, after: cursor ?? undefined }} nextCursor={page.nextCursor} shown={page.rows.length} />
      </Section>
    </div>
  );
}
