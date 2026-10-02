import Link from "next/link";
import { ExportButton, Mono, Money, Pager } from "@/components/admin/controls";
import AccountLabel from "@/components/admin/AccountLabel";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import { definedOnly, paramsOf, parseAttemptFilters, parseCursor, parseRevenueFilters } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { fmtDenver } from "@/lib/admin/format";
import { pageCtx } from "@/lib/admin/pageCtx";
import { pageOf, decodeCursor, byTimeDescIdDesc } from "@/lib/billing/reports/evidence";
import { accountInfo } from "@/lib/billing/reports/labels";
import { fmtMoney, sumOf } from "@/lib/billing/reports/money";
import { attemptsDetail, CLASS_LABEL, fetchLedgerRows, netOf, providerLabel, refundNote, revenueClassOf, revenueDetail, type LedgerRow } from "@/lib/billing/reports/revenue";

export const dynamic = "force-dynamic";

/** Drill-down: the ledger rows behind a revenue (or attempts) cell. Same fetch + same rule as the summary page and the CSV. */
export default async function RevenueRowsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const attempts = p.get("view") === "attempts";
  const cursor = parseCursor(p);
  const rf = parseRevenueFilters(p, now);
  const af = parseAttemptFilters(p, now);
  const filters = attempts ? definedOnly(af) : definedOnly(rf);
  const [ledger, info] = await Promise.all([fetchLedgerRows(db, { fromMonth: rf.fromMonth, toMonth: rf.toMonth, accountId: attempts ? undefined : rf.accountId }), accountInfo(db)]);

  const all: LedgerRow[] = attempts ? attemptsDetail(ledger, af) : revenueDetail(ledger, rf);
  const page = pageOf([...all].sort(byTimeDescIdDesc((r) => ({ t: r.occurredAt.toISOString(), id: r.ghlTransactionId }))), (r) => ({ t: r.occurredAt.toISOString(), id: r.ghlTransactionId }), decodeCursor(cursor));
  const total = attempts ? sumOf(all.map((r) => r.amount)) : sumOf(all.map(netOf));
  const path = "/revenue/rows";
  const exportParams = { ...filters, detail: 1 };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub={attempts ? "Ledger rows that are not revenue (failed, pending, $0 trials, failed signups)." : "Ledger rows counted as revenue: succeeded or refunded, net of refunds."}>{attempts ? "Attempts — rows" : "Revenue — rows"}</PageTitle>
        <ExportButton view={attempts ? "attempts" : "revenue"} params={exportParams} label="Export these rows CSV" />
      </div>
      <p className="mt-3 text-sm text-white/60">
        Filters: {Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(" · ") || "none"} — <Link className="text-gold hover:underline" href={adminHref(base, "/revenue", { from: rf.fromMonth, to: rf.toMonth })}>back to summary</Link>
      </p>
      <p className="mt-2 text-sm text-white">{all.length} rows · {attempts ? "gross attempted" : "net"} <Money>{fmtMoney(total)}</Money></p>

      <Section title="Ledger rows" note={attempts ? undefined : "Refunds are attributed to the original transaction’s month; “predates tracking” means the refund happened before refundDetectedAt existed."}>
        <Table
          head={["GHL transaction", "Date (Denver)", "Account", "Class", "Status", "Amount", "Refunded", "Provider"]}
          rows={page.rows.map((r) => [
            <Mono key="id">{r.ghlTransactionId}</Mono>,
            fmtDenver(r.occurredAt),
            r.ghlAccountId ? (
              <Link key="a" href={adminHref(base, `/members/${r.ghlAccountId}`)} className="hover:text-gold"><AccountLabel locationId={info.get(r.ghlAccountId)?.locationId} locationName={info.get(r.ghlAccountId)?.locationName} businessName={info.get(r.ghlAccountId)?.businessName} /></Link>
            ) : (
              <span key="a" className="text-white/50">Unmatched (no account)</span>
            ),
            attempts ? r.classification : CLASS_LABEL[revenueClassOf(r.classification)],
            r.status,
            <Money key="m">{fmtMoney(r.amount)}</Money>,
            Number(r.amountRefunded) === 0 ? "—" : <span key="f"><Money>{fmtMoney(r.amountRefunded)}</Money> <span className="text-xs text-white/40">{refundNote(r)}</span></span>,
            providerLabel(r.provider),
          ])}
          empty="No rows."
        />
        <Pager base={base} path={path} params={{ ...filters, view: attempts ? "attempts" : undefined, after: cursor ?? undefined }} nextCursor={page.nextCursor} shown={page.rows.length} />
      </Section>
    </div>
  );
}
