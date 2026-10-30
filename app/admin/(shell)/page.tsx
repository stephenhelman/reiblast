import Link from "next/link";
import { PrintButton } from "@/components/admin/statement";
import { StaleBanner, StatusBadge, Notice, btnCls, ghostBtnCls, inputCls, labelCls } from "@/components/admin/statementUi";
import { ExportButton } from "@/components/admin/controls";
import { Banner, PageTitle, Section, Table } from "@/components/admin/ui";
import Card from "@/components/shared/Card";
import { fmtCents, fmtDenver, fmtDenverDate } from "@/lib/admin/format";
import { paramsOf } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { addMonths, currentDenverMonth, isMonth } from "@/lib/billing/reports/denver";
import { canCloseMonth } from "@/lib/billing/statement/close";
import { computeMonthStatement, FIRST_STATEMENT_MONTH, outstandingBalance } from "@/lib/billing/statement/compute";
import { lineDataThrough, staleSources } from "@/lib/billing/statement/freshness";
import { loadFreshness } from "@/lib/billing/statement/loadPage";
import { closeMonthAction, recordPaymentAction, reopenMonthAction } from "./statement-actions";

export const dynamic = "force-dynamic";

const todayIso = (d: Date) => d.toISOString().slice(0, 10);

export default async function PartnerStatementPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const current = currentDenverMonth(now);
  const asked = p.get("month");
  const month = isMonth(asked) && asked >= FIRST_STATEMENT_MONTH && asked <= current ? asked : current < FIRST_STATEMENT_MONTH ? FIRST_STATEMENT_MONTH : current;

  const [s, fresh, out, payments, close, kurv] = await Promise.all([
    computeMonthStatement(db, month, { now, hq }),
    loadFreshness(db, month),
    outstandingBalance(db),
    db.partnerPayment.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 12 }),
    db.monthClose.findUnique({ where: { month } }),
    db.kurvStatement.findUnique({ where: { month }, select: { month: true } }),
  ]);
  const through = lineDataThrough(s, fresh);
  const stale = s.closed ? [] : staleSources(fresh, now);
  const check = canCloseMonth({ month, now, hasKurvStatement: !!kurv, alreadyClosed: s.closed });
  const hasEstimate = s.lines.some((l) => l.basis === "estimate");
  const costsHref = (params: Record<string, string>) => adminHref(base, "/costs/rows", { from: month, to: month, month, ...params });
  const drill: Record<string, { href: string; label: string }[]> = {
    deposits: [{ href: adminHref(base, "/cash", { month }) + "#batches", label: "Batches" }, { href: adminHref(base, "/revenue/rows", { from: month, to: month, month }), label: "Revenue rows" }],
    monthly_debit: [{ href: adminHref(base, "/cash", { month }) + "#kurv", label: "Kurv statement" }],
    agency_plan: [{ href: adminHref(base, "/settings"), label: "Settings" }],
    authorize_net: [{ href: adminHref(base, "/settings"), label: "Settings" }],
    agency_wallet: [{ href: adminHref(base, "/costs", { from: month, to: month }), label: "Costs" }],
  };
  const keep = { month };
  const monthOptions: string[] = [];
  for (let m = FIRST_STATEMENT_MONTH; m <= current; m = addMonths(m, 1)) monthOptions.push(m);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub="What REIblast owes Stephen: 50% of Kurv bank deposits less processor and platform costs. Starts 2026-10-01; no opening balance. Stephen's own costs are not on the statement.">Partner Statement</PageTitle>
        <div className="flex items-center gap-2 print:hidden">
          <ExportButton view="statement" params={{ month }} label="Export CSV" />
          <PrintButton />
        </div>
      </div>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 print:hidden">
        <label className={labelCls}>
          Statement month (Kurv deposit month)
          <select name="month" defaultValue={month} className={inputCls}>
            {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button type="submit" className={btnCls}>Show</button>
      </form>

      <Notice notice={p.get("notice")} error={p.get("error")} />
      <StaleBanner sources={stale} />
      {s.partial && !s.closed && <Banner tone="warn">{month} is still open: every figure is to date. Deposits for sales through the last day of the month land in early {addMonths(month, 1)}, and Kurv&apos;s monthly debit posts around the 1st.</Banner>}
      {!s.wallet.hasData && !s.closed && <Banner tone="bad">No GHL wallet rows are loaded for {month}, so the wallet usage line is $0.00, not &quot;no usage&quot;. Load them before relying on this statement.</Banner>}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card variant="highlight" className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-white/50">
            <span>{s.closed ? `Owed to Stephen — ${month}` : "Owed to Stephen (to date)"}</span>
            {s.closed ? <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Closed {fmtDenverDate(s.closedAt)}</span> : hasEstimate && <StatusBadge basis="estimate" />}
          </div>
          <div className={`mt-2 text-4xl font-bold tabular-nums ${s.owedCents < 0 ? "text-red-300" : "text-gold"}`} data-testid="owed">{fmtCents(s.owedCents)}</div>
          <div className="mt-1 text-sm text-white/50">{+(s.splitPct * 100).toFixed(4)}% of {fmtCents(s.netCents)} net for {month}{s.closed ? "" : "; not final until the month is closed"}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-white/50">Outstanding balance</div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-white" data-testid="outstanding">{fmtCents(out.outstandingCents)}</div>
          <div className="mt-1 text-sm text-white/50">Closed months owed {fmtCents(out.owedClosedCents)} − paid by Ari {fmtCents(out.paidCents)}</div>
        </Card>
      </div>

      <Section title={`Statement — ${month}`} note="Deposits less each cost. Estimate rows turn to actual when the Kurv statement is entered.">
        <Table
          head={["Line", "Amount", "", "Source", "Data through", ""]}
          rows={[
            ...s.lines.map((l) => [
              <span key="l" className={l.key === "deposits" ? "font-semibold text-white" : ""}>{l.key === "deposits" ? "" : "− "}{l.label}</span>,
              <span key="a" className="tabular-nums">{fmtCents(l.amountCents)}</span>,
              <StatusBadge key="b" basis={l.basis} />,
              <span key="s" className="text-xs text-white/50">{l.source}</span>,
              <span key="t" className="whitespace-nowrap text-xs text-white/60">{through[l.key].text}{through[l.key].at ? ` ${fmtDenver(through[l.key].at)}` : ""}</span>,
              <span key="d" className="flex flex-wrap gap-x-3 text-xs print:hidden">{drill[l.key].map((d) => <Link key={d.label} href={d.href} className="text-gold hover:underline">{d.label}</Link>)}</span>,
            ]),
            [<strong key="n">Net</strong>, <strong key="v" className="tabular-nums">{fmtCents(s.netCents)}</strong>, "", "", "", ""],
            [<strong key="o" className="text-gold">{s.closed ? "Owed to Stephen" : "Owed to Stephen (to date)"}</strong>, <strong key="v" className="tabular-nums text-gold">{fmtCents(s.owedCents)}</strong>, "", <span key="s" className="text-xs text-white/50">{+(s.splitPct * 100).toFixed(4)}% of net</span>, "", ""],
          ]}
        />
      </Section>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-sm font-bold text-white">Bank deposits, in detail</h3>
          <dl className="mt-3 space-y-1 text-sm text-white/80">
            <Row k={`Gross settled sales (${s.deposits.items} sales, ${s.deposits.batches} batches)`} v={fmtCents(s.deposits.grossCents)} />
            <Row k="− Daily fees (incl. discount)" v={fmtCents(s.deposits.dailyFeesCents)} />
            {s.deposits.discountCents !== null && <Row k="   discount / per-item, batch & interchange" v={`${fmtCents(s.deposits.discountCents)} / ${fmtCents(s.deposits.otherFeesCents ?? 0)}`} dim />}
            <Row k="− Reserve funded (company money)" v={fmtCents(s.deposits.reserveCents)} />
            <Row k="= Bank deposits" v={fmtCents(s.deposits.depositCents)} strong />
          </dl>
          {s.monthlyDebit.estimate && (
            <>
              <h3 className="mt-5 text-sm font-bold text-white">Monthly debit estimate {s.monthlyDebit.toDateOnly && <span className="font-normal text-white/50">(activity to date)</span>}</h3>
              <dl className="mt-3 space-y-1 text-sm text-white/80">
                <Row k={`${s.monthlyDebit.estimate.authorizations} authorizations`} v={fmtCents(s.monthlyDebit.estimate.authFeesCents)} />
                <Row k="AVS checks (estimate)" v={fmtCents(s.monthlyDebit.estimate.avsFeesCents)} />
                <Row k="Card-brand fees (~0.6%)" v={fmtCents(s.monthlyDebit.estimate.brandFeesCents)} />
                <Row k="Fixed monthly fees" v={fmtCents(s.monthlyDebit.estimate.fixedCents)} />
              </dl>
            </>
          )}
        </Card>
        <Card>
          <h3 className="text-sm font-bold text-white">GHL agency wallet usage, by category</h3>
          <p className="mt-1 text-xs text-white/50">{s.wallet.debitCount.toLocaleString()} debit rows. Recharge credits ({fmtCents(s.wallet.rechargeCreditsCents)}) are not a cost{s.wallet.planRowsExcluded.count ? `; ${s.wallet.planRowsExcluded.count} plan-like rows (${fmtCents(s.wallet.planRowsExcluded.cents)}) left out to avoid double-counting the agency plan` : "; no agency-plan row was found in the wallet, so nothing is double-counted"}.</p>
          <dl className="mt-3 space-y-1 text-sm text-white/80">
            {byCategory(s.wallet.breakdown).map((c) => (
              <div key={c.category} className="flex justify-between gap-4">
                <dt><Link href={costsHref({ category: c.category })} className="hover:text-gold">{c.category.replace(/_/g, " ")}</Link>{c.category.startsWith("a2p") && <span className="ml-1 text-xs text-gold">A2P</span>}</dt>
                <dd className="tabular-nums">{fmtCents(c.cents)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-white/50">By scope: {byScope(s.wallet.breakdown).map((x) => `${x.scope} ${fmtCents(x.cents)}`).join(" · ") || "—"}</p>
        </Card>
      </div>

      <Card className="mt-6">
        <h3 className="text-sm font-bold text-white">Reserve fund — company money, never split</h3>
        <p className="mt-2 text-sm text-white/70">
          Funded this month {fmtCents(s.reserve.fundedCents)} · released {fmtCents(s.reserve.releasesCents)} (excluded from income) · withdrawn {fmtCents(s.reserve.withdrawalsCents)} · balance at end of {month} <strong className="text-white">{fmtCents(s.reserve.closingBalanceCents)}</strong>.{" "}
          <Link href={adminHref(base, "/cash", { month })} className="text-gold hover:underline print:hidden">Reserve fund →</Link>
        </p>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 print:hidden">
        <Card>
          <h3 className="text-sm font-bold text-white">Record payment from Ari</h3>
          <form action={recordPaymentAction} className="mt-3 space-y-3">
            <input type="hidden" name="month" value={month} />
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>Date received<input type="date" name="date" required defaultValue={todayIso(now)} className={inputCls} /></label>
              <label className={labelCls}>Amount ($)<input name="amount" inputMode="decimal" required placeholder="0.00" className={inputCls} /></label>
            </div>
            <label className={labelCls}>Note (optional)<input name="note" maxLength={300} className={inputCls} /></label>
            <button type="submit" className={btnCls}>Record payment</button>
          </form>
          <Table head={["Date", "Amount", "Note"]} rows={payments.map((x) => [x.date.toISOString().slice(0, 10), <span key="a" className="tabular-nums">{fmtCents(x.amountCents)}</span>, x.note ?? ""])} empty="No payments recorded yet." />
        </Card>
        <Card>
          <h3 className="text-sm font-bold text-white">Close month</h3>
          {s.closed ? (
            <>
              <p className="mt-2 text-sm text-white/70">{month} was closed {fmtDenver(s.closedAt)}. Its figures are frozen from the snapshot and count toward the outstanding balance.</p>
              <form action={reopenMonthAction} className="mt-4 space-y-3 rounded-lg border border-red-500/30 p-3">
                <input type="hidden" name="month" value={month} />
                <p className="text-xs text-red-200">Reopening unfreezes {month}: it recomputes live and stops counting toward the outstanding balance until closed again.</p>
                <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" name="confirm" /> I understand</label>
                <label className={labelCls}>Type {month} to confirm<input name="typed" autoComplete="off" className={inputCls} /></label>
                <button type="submit" className={ghostBtnCls}>Reopen {month}</button>
              </form>
            </>
          ) : (
            <form action={closeMonthAction} className="mt-3 space-y-3">
              <input type="hidden" name="month" value={month} />
              <p className="text-sm text-white/70">Freezes this statement (every line) and adds {fmtCents(s.owedCents)} to what Ari owes. Needs the month to have ended and the Kurv statement entered.</p>
              {!check.ok && <p className="text-sm text-gold" data-testid="close-reason">{check.reason}</p>}
              <button type="submit" disabled={!check.ok} className={btnCls}>Close {month}</button>
            </form>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-white/40">{close && close.reopenedAt ? `Reopened ${fmtDenver(close.reopenedAt)}. ` : ""}All times America/Denver. Estimates use dated rates (Settings). Not a bank reconciliation.</p>
    </div>
  );
}

function Row({ k, v, strong, dim }: { k: string; v: string; strong?: boolean; dim?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t border-border-default pt-1 font-semibold text-white" : ""} ${dim ? "text-xs text-white/50" : ""}`}>
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function byCategory(rows: { category: string; cents: number }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + r.cents);
  return [...m].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
}
function byScope(rows: { scope: string; cents: number }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.scope, (m.get(r.scope) ?? 0) + r.cents);
  return [...m].map(([scope, cents]) => ({ scope, cents }));
}
