import Link from "next/link";
import { Notice, StaleBanner, btnCls, inputCls, labelCls } from "@/components/admin/statementUi";
import { Banner, PageTitle, Section, Table } from "@/components/admin/ui";
import Card from "@/components/shared/Card";
import { fmtCents, fmtDenver } from "@/lib/admin/format";
import { paramsOf } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { sumBatchFees } from "@/lib/billing/kurv/fees";
import { kurvRatesAsOf, MissingRateError } from "@/lib/billing/kurv/rates";
import { addMonths, currentDenverMonth, denverStamp, isMonth } from "@/lib/billing/reports/denver";
import { computeLiveStatement, FIRST_STATEMENT_MONTH, loadBatches, reserveBalance } from "@/lib/billing/statement/compute";
import { staleSources } from "@/lib/billing/statement/freshness";
import { loadFreshness } from "@/lib/billing/statement/loadPage";
import { addReserveMovementAction, saveKurvStatementAction } from "../statement-actions";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${+(x * 100).toFixed(4)}%`;
const dollars = (c: number | undefined) => (c === undefined ? "" : (c / 100).toFixed(2));

export default async function CashPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const current = currentDenverMonth(now);
  const asked = p.get("month");
  const month = isMonth(asked) && asked >= FIRST_STATEMENT_MONTH && asked <= current ? asked : current < FIRST_STATEMENT_MONTH ? FIRST_STATEMENT_MONTH : current;

  try {
    kurvRatesAsOf(await db.settingRate.findMany(), `${month}-01`);
  } catch (e) {
    if (!(e instanceof MissingRateError)) throw e;
    return (
      <div>
        <PageTitle sub="Setup needed.">Cash &amp; Processor</PageTitle>
        <Banner tone="warn">The dated Kurv rates haven&apos;t been seeded in this database yet ({e.key}). Run <code>scripts/billing/seed-statement.ts</code> (ship plan, step 4) or add rows on <Link className="underline" href={adminHref(base, "/settings")}>Settings</Link>.</Banner>
      </div>
    );
  }
  const [batches, rateRows, est, kurv, fresh, balance, moves] = await Promise.all([
    loadBatches(db, month),
    db.settingRate.findMany(),
    computeLiveStatement(db, month, { now, hq, forceEstimate: true }),
    db.kurvStatement.findUnique({ where: { month } }),
    loadFreshness(db, month),
    reserveBalance(db, current),
    db.reserveMovement.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 30 }),
  ]);
  const rates = kurvRatesAsOf(rateRows, `${month}-01`);
  const monthOptions: string[] = [];
  for (let m = FIRST_STATEMENT_MONTH; m <= current; m = addMonths(m, 1)) monthOptions.push(m);
  const e = est.deposits, debitEst = est.lines.find((l) => l.key === "monthly_debit")!.amountCents;
  const variance = kurv
    ? [
        ["Sales count", e.items, kurv.salesCount, "count"],
        ["Sales amount", e.grossCents, kurv.salesAmountCents, "usd"],
        ["Daily fees (incl. discount)", e.dailyFeesCents, kurv.dailyFeesPaidCents, "usd"],
        ["Reserve funded", e.reserveCents, kurv.reserveFundedCents, "usd"],
        ["Monthly debit", debitEst, kurv.monthlyDebitCents, "usd"],
      ] as const
    : [];
  const fmt = (v: number, k: "count" | "usd") => (k === "usd" ? fmtCents(v) : String(v));

  return (
    <div>
      <PageTitle sub="Kurv batches, the Kurv statement and the reserve fund. A batch is the 5:00 PM Denver window; Saturday's window is labeled Sunday; deposits land the next bank day.">Cash &amp; Processor</PageTitle>
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <label className={labelCls}>Month (by deposit date)
          <select name="month" defaultValue={month} className={inputCls}>{monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <button type="submit" className={btnCls}>Show</button>
      </form>
      <Notice notice={p.get("notice")} error={p.get("error")} />
      <StaleBanner sources={staleSources(fresh, now)} />

      <div id="batches">
        <Section title={`Batches depositing in ${month}`} note={`${batches.length} batches. Fees are ESTIMATES from the dated Kurv rates (${pct(rates.discountRate)} + $${rates.perItem.toFixed(2)}/non-Amex item + $${rates.perBatch.toFixed(2)}/batch + ~${pct(rates.interchangeRate)} interchange); reserve is ${pct(rates.reserveRate)} of gross.`}>
          <Table
            head={["Window opens (Denver)", "Label", "Items", "Gross", "Est. daily fees", "Reserve", "Expected deposit", "Deposit date"]}
            rows={[
              ...batches.map((b) => {
                const f = sumBatchFees([b], rates);
                return [denverStamp(b.windowStart).slice(0, 16), b.batchDate, b.items, <span key="g" className="tabular-nums">{fmtCents(b.grossCents)}</span>, <span key="f" className="tabular-nums">{fmtCents(f.discountCents + f.otherFeesCents)}</span>, <span key="r" className="tabular-nums">{fmtCents(f.reserveCents)}</span>, <span key="d" className="tabular-nums">{fmtCents(f.depositCents)}</span>, b.depositDate];
              }),
              (() => {
                const t = sumBatchFees(batches, rates);
                return [<strong key="t">Total</strong>, "", <strong key="i">{t.items}</strong>, <strong key="g" className="tabular-nums">{fmtCents(t.grossCents)}</strong>, <strong key="f" className="tabular-nums">{fmtCents(t.discountCents + t.otherFeesCents)}</strong>, <strong key="r" className="tabular-nums">{fmtCents(t.reserveCents)}</strong>, <strong key="d" className="tabular-nums">{fmtCents(t.depositCents)}</strong>, ""];
              })(),
            ]}
            empty="No settled batches deposit in this month yet."
          />
        </Section>
      </div>

      <div id="kurv" className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="text-lg font-bold text-white">Kurv statement — {month}</h2>
          <p className="mt-1 text-sm text-white/50">{kurv ? `Entered ${fmtDenver(kurv.enteredAt)}. Saving again replaces it.` : "Not entered: the statement uses estimates."} Enter figures exactly as Kurv reports them (daily fees include the discount).</p>
          <form action={saveKurvStatementAction} className="mt-3 grid grid-cols-2 gap-3">
            <input type="hidden" name="month" value={month} />
            <label className={labelCls}>Sales count<input name="salesCount" inputMode="numeric" required defaultValue={kurv?.salesCount} className={inputCls} /></label>
            <label className={labelCls}>Sales amount ($)<input name="salesAmount" inputMode="decimal" required defaultValue={dollars(kurv?.salesAmountCents)} className={inputCls} /></label>
            <label className={labelCls}>Daily fees paid, incl. discount ($)<input name="dailyFeesPaid" inputMode="decimal" required defaultValue={dollars(kurv?.dailyFeesPaidCents)} className={inputCls} /></label>
            <label className={labelCls}>Reserve funded ($)<input name="reserveFunded" inputMode="decimal" required defaultValue={dollars(kurv?.reserveFundedCents)} className={inputCls} /></label>
            <label className={labelCls}>Reserve released ($)<input name="reserveReleased" inputMode="decimal" required defaultValue={dollars(kurv?.reserveReleasedCents ?? 0)} className={inputCls} /></label>
            <label className={labelCls}>Monthly debit ($)<input name="monthlyDebit" inputMode="decimal" required defaultValue={dollars(kurv?.monthlyDebitCents)} className={inputCls} /></label>
            <label className={`${labelCls} col-span-2`}>Notes<input name="notes" maxLength={500} defaultValue={kurv?.notes ?? ""} className={inputCls} /></label>
            <div className="col-span-2"><button type="submit" className={btnCls}>Save Kurv statement</button></div>
          </form>
        </Card>
        <Card>
          <h2 className="text-lg font-bold text-white">Estimate vs actual</h2>
          {kurv ? (
            <Table
              head={["", "Estimate", "Kurv actual", "Variance"]}
              rows={variance.map(([label, est, act, kind]) => [label, fmt(est, kind), fmt(act, kind), <span key="v" className={act - est === 0 ? "" : Math.abs(act - est) > Math.abs(est) * 0.05 ? "text-red-300" : "text-white/70"}>{act - est >= 0 ? "+" : ""}{fmt(act - est, kind)}{est ? ` (${(((act - est) / est) * 100).toFixed(1)}%)` : ""}</span>])}
            />
          ) : (
            <p className="mt-2 text-sm text-white/50">Enter the Kurv statement to compare it with the model. Current estimate for {month}: daily fees {fmtCents(e.dailyFeesCents)}, reserve {fmtCents(e.reserveCents)}, monthly debit {fmtCents(debitEst)}{est.partial ? " (to date)" : ""}.</p>
          )}
          <p className="mt-3 text-xs text-white/40">The AVS part of the monthly debit is itself an estimate (avsPerAuthRatio). Variances over 5% are red.</p>
        </Card>
      </div>

      <div id="reserve" className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <div className="text-xs uppercase tracking-wide text-white/50">Reserve fund balance (through {current})</div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-white">{fmtCents(balance)}</div>
          <p className="mt-1 text-sm text-white/50">Company money (expansion / emergency). 10% of settled sales is added by deposit month; it is never part of the partner split. Opening balance $514.51 at 2026-09-30.</p>
          <h3 className="mt-5 text-sm font-bold text-white">Release / withdrawal / adjustment</h3>
          <form action={addReserveMovementAction} className="mt-3 grid grid-cols-2 gap-3">
            <input type="hidden" name="month" value={month} />
            <label className={labelCls}>Date<input type="date" name="date" required defaultValue={now.toISOString().slice(0, 10)} className={inputCls} /></label>
            <label className={labelCls}>Kind
              <select name="kind" className={inputCls}>
                <option value="release">Release (Kurv paid it into the bank)</option>
                <option value="withdrawal">Withdrawal (company took it out)</option>
                <option value="adjustment">Adjustment (signed)</option>
              </select>
            </label>
            <label className={labelCls}>Amount ($)<input name="amount" inputMode="decimal" required className={inputCls} /></label>
            <label className={labelCls}>Note<input name="note" maxLength={300} className={inputCls} /></label>
            <div className="col-span-2"><button type="submit" className={btnCls}>Record movement</button></div>
          </form>
          <p className="mt-3 text-xs text-white/40">A release lands in Ari&apos;s bank as a deposit; it reduces the fund and is excluded from statement income.</p>
        </Card>
        <Card>
          <h3 className="text-sm font-bold text-white">Movements</h3>
          <Table head={["Date", "Kind", "Amount", "Note"]} rows={moves.map((m) => [m.date.toISOString().slice(0, 10), m.kind, <span key="a" className="tabular-nums">{fmtCents(m.amountCents)}</span>, m.note ?? ""])} empty="No movements." />
          <p className="mt-3 text-xs text-white/50">Back to <Link href={adminHref(base, "/", { month })} className="text-gold hover:underline">Partner Statement</Link>.</p>
        </Card>
      </div>
    </div>
  );
}
