import type { MonthStatement } from "./types";
import type { Row } from "../../admin/csv";

export const STATEMENT_COLUMNS = ["section", "label", "amount_usd", "basis", "source", "detail"];
const usd = (c: number) => (c / 100).toFixed(2);

/** Flat CSV rows for one statement: lines, the deposit/debit/wallet breakdowns, net, owed, reserve. */
export function statementRows(s: MonthStatement): Row[] {
  const status = s.closed ? `closed ${s.closedAt ?? ""}`.trim() : s.partial ? "open, to date" : "open";
  const rows: Row[] = [];
  for (const l of s.lines) rows.push({ section: "line", label: l.key === "deposits" ? l.label : `− ${l.label}`, amount_usd: usd(l.amountCents), basis: l.basis, source: l.source, detail: "" });
  rows.push({ section: "total", label: "Net", amount_usd: usd(s.netCents), basis: "", source: "", detail: status });
  rows.push({ section: "total", label: `Owed to Stephen (${+(s.splitPct * 100).toFixed(4)}%)${s.closed ? "" : " (to date)"}`, amount_usd: usd(s.owedCents), basis: s.lines.some((l) => l.basis === "estimate") ? "estimate" : "actual", source: "", detail: status });
  const d = s.deposits;
  rows.push({ section: "deposits", label: "Gross settled sales", amount_usd: usd(d.grossCents), basis: d.basis, source: "", detail: `${d.items} sales, ${d.batches} batches` });
  rows.push({ section: "deposits", label: "Daily fees (incl. discount)", amount_usd: usd(-d.dailyFeesCents), basis: d.basis, source: "", detail: d.discountCents === null ? "" : `discount ${usd(d.discountCents)} + other ${usd(d.otherFeesCents ?? 0)}` });
  rows.push({ section: "deposits", label: "Reserve funded (company money)", amount_usd: usd(-d.reserveCents), basis: d.basis, source: "", detail: "" });
  const e = s.monthlyDebit.estimate;
  if (e) for (const [label, c] of [["Authorizations", e.authFeesCents], ["AVS checks (estimate)", e.avsFeesCents], ["Card-brand fees", e.brandFeesCents], ["Fixed monthly fees", e.fixedCents]] as const) rows.push({ section: "monthly_debit", label, amount_usd: usd(c), basis: "estimate", source: "", detail: label === "Authorizations" ? `${e.authorizations} authorizations` : "" });
  for (const w of s.wallet.breakdown) rows.push({ section: "wallet", label: `${w.category} (${w.scope})`, amount_usd: usd(w.cents), basis: "actual", source: "", detail: `${w.count} rows` });
  rows.push({ section: "reserve", label: "Reserve funded", amount_usd: usd(s.reserve.fundedCents), basis: d.basis, source: "", detail: "Never split" });
  rows.push({ section: "reserve", label: "Reserve releases (excluded from income)", amount_usd: usd(s.reserve.releasesCents), basis: "actual", source: "", detail: "" });
  rows.push({ section: "reserve", label: "Reserve withdrawals", amount_usd: usd(s.reserve.withdrawalsCents), basis: "actual", source: "", detail: "" });
  rows.push({ section: "reserve", label: "Reserve balance, end of month", amount_usd: usd(s.reserve.closingBalanceCents), basis: "", source: "", detail: "" });
  return rows;
}
