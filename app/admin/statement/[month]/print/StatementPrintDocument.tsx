import React from "react";
import AutoPrint from "@/components/admin/AutoPrint";
import { fmtCents, fmtDenver, fmtDenverDate } from "@/lib/admin/format";
import type { MonthStatement } from "@/lib/billing/statement/types";
import { monthLabel, printWalletRows } from "@/lib/billing/statement/printModel";
import { PRINT_CSS } from "./printCss";

export type PrintPayment = { id: string; date: Date; note: string | null; amountCents: number };

/** The printable partner statement (presentational; the route loads the data). */
export function StatementPrintDocument({ s, month, out, payments, now, autoprint }: { s: MonthStatement; month: string; out: { owedClosedCents: number; paidCents: number; outstandingCents: number }; payments: PrintPayment[]; now: Date; autoprint?: boolean }) {
  const label = monthLabel(month);
  const pct = +(s.splitPct * 100).toFixed(4);
  const wallet = printWalletRows(s.wallet.breakdown);
  const status = s.closed ? `Final — closed on ${fmtDenverDate(s.closedAt)}` : "Preliminary — to date";

  return (
    <div className="ps-root">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {autoprint ? <AutoPrint /> : null}
      {!s.closed && <div className="ps-watermark" aria-hidden="true">Preliminary</div>}
      <div className="ps-page">
        <header className="ps-header">
          <div>
            <h1>REIblast — Partner Statement</h1>
            <div className="ps-month">{label}</div>
          </div>
          <div className="ps-meta">
            <div className={s.closed ? "ps-status ps-final" : "ps-status ps-prelim"}>{status}</div>
            <div>Generated {fmtDenver(now)}</div>
          </div>
        </header>

        <section className="ps-headline ps-avoid">
          <div className="ps-eyebrow">Owed to Stephen{s.closed ? "" : " (to date)"}</div>
          <div className={s.owedCents < 0 ? "ps-owed ps-neg" : "ps-owed"}>{fmtCents(s.owedCents)}</div>
          <div className="ps-sub">{pct}% of {fmtCents(s.netCents)} net</div>
        </section>

        <section className="ps-avoid">
          <h2>Statement</h2>
          <table className="ps-table">
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.key === "deposits" ? "" : "− "}{l.label}</td>
                  <td className="ps-tag-cell"><span className={l.basis === "actual" ? "ps-tag ps-actual" : "ps-tag ps-est"}>{l.basis === "actual" ? "Actual" : "Estimate"}</span></td>
                  <td className="ps-amt">{fmtCents(l.amountCents)}</td>
                </tr>
              ))}
              <tr className="ps-net">
                <td colSpan={2}>Net</td>
                <td className="ps-amt">{fmtCents(s.netCents)}</td>
              </tr>
              <tr className="ps-owedrow">
                <td colSpan={2}>Owed to Stephen ({pct}% of net)</td>
                <td className="ps-amt">{fmtCents(s.owedCents)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="ps-avoid">
          <h2>Wallet usage by category</h2>
          {wallet.length === 0 ? (
            <p className="ps-note">{s.wallet.hasData ? "No wallet usage this month." : "No wallet data loaded for this month."}</p>
          ) : (
            <ul className="ps-wallet">
              {wallet.map((w) => (
                <li key={w.label}><span>{w.label}</span><span className="ps-amt">{fmtCents(w.cents)}</span></li>
              ))}
            </ul>
          )}
        </section>

        <section className="ps-avoid">
          <h2>Company reserve — not split</h2>
          <p className="ps-reserve">
            <span>Funded <b>{fmtCents(s.reserve.fundedCents)}</b></span>
            <span>Released <b>{fmtCents(s.reserve.releasesCents)}</b></span>
            <span>Withdrawn <b>{fmtCents(s.reserve.withdrawalsCents)}</b></span>
            <span>Balance <b>{fmtCents(s.reserve.closingBalanceCents)}</b></span>
          </p>
        </section>

        <section className="ps-avoid">
          <h2>Payments received from Ari</h2>
          {payments.length === 0 ? (
            <p className="ps-note">No payments recorded yet.</p>
          ) : (
            <table className="ps-table ps-pay">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="ps-date">{p.date.toISOString().slice(0, 10)}</td>
                    <td>{p.note ?? ""}</td>
                    <td className="ps-amt">{fmtCents(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="ps-outstanding">
            <span>Outstanding balance <small>(closed months owed {fmtCents(out.owedClosedCents)} − paid {fmtCents(out.paidCents)})</small></span>
            <span className="ps-amt">{fmtCents(out.outstandingCents)}</span>
          </div>
        </section>

        <footer className="ps-footer">All times America/Denver. Bank deposits, Kurv fees and reserve per the Kurv statement for {label}.</footer>
      </div>
    </div>
  );
}
