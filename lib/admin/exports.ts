import type { PrismaClient } from "@prisma/client";
import { CLASSIFIER_VERSION } from "@/lib/billing/classify";
import { costCells, costDetailChunks, costWhere, SCOPE_LABEL, GROUP_LABEL, costGroupOf, scopeClassOf, summarizeCosts, usageByScope } from "@/lib/billing/reports/costs";
import { denverMonthOf, denverStamp } from "@/lib/billing/reports/denver";
import { walletChunks } from "@/lib/billing/reports/evidence";
import { buildAgencyMargin, buildMemberMargin, parseFeePct, sortMemberMargin } from "@/lib/billing/reports/margin";
import { loadMembers, matchesState, sortMembers } from "@/lib/billing/reports/members";
import { aggregateAttempts, aggregateRevenue, attemptsDetail, CLASS_LABEL, fetchLedgerRows, netOf, providerLabel, refundNote, revenueClassOf, revenueDetail, type LedgerRow } from "@/lib/billing/reports/revenue";
import { accountLabel, formatAccountLabel } from "./accountLabel";
import { accountInfo, accountLabelText, scopeLabelOf, type AcctInfo } from "@/lib/billing/reports/labels";
import type { CsvSpec, Row } from "./csv";
import { definedOnly, parseAttemptFilters, parseCostFilters, parseMarginSort, parseMemberFilters, parseMemberId, parseRange, parseRevenueFilters, type Params } from "./filters";

export const EXPORT_VIEWS = ["revenue", "attempts", "costs", "margin", "members", "member-ledger", "member-usage"] as const;
export type ExportView = (typeof EXPORT_VIEWS)[number];
export const isExportView = (v: string): v is ExportView => (EXPORT_VIEWS as readonly string[]).includes(v);

export type BuiltExport = { ok: true; spec: CsvSpec; filename: string } | { ok: false; status: number; message: string };
type Ctx = { hq: string | null; now: Date; env?: Record<string, string | undefined> };

async function* fromArray<T>(rows: T[], size = 2000): AsyncGenerator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

const acctLabel = accountLabelText;

// ── ledger row shape (revenue detail, attempts detail, member-ledger) ───────

const LEDGER_COLUMNS = ["ghl_transaction_id", "occurred_at_utc", "occurred_at_denver", "denver_month", "account_id", "account_label", "location_id", "classification", "revenue_class", "classifier_version", "status", "amount", "amount_refunded", "net", "provider", "provider_label", "subscription_id", "refund_detected_at_utc", "refund_note"];
const LEDGER_TEXT = ["account_label", "provider", "provider_label", "refund_note"];

function ledgerRow(r: LedgerRow, info: Map<string, AcctInfo>, hq: string | null): Row {
  return {
    ghl_transaction_id: r.ghlTransactionId,
    occurred_at_utc: r.occurredAt,
    occurred_at_denver: denverStamp(r.occurredAt),
    denver_month: denverMonthOf(r.occurredAt),
    account_id: r.ghlAccountId,
    account_label: acctLabel(info, r.ghlAccountId, hq),
    location_id: r.ghlAccountId ? info.get(r.ghlAccountId)?.locationId : null,
    classification: r.classification,
    revenue_class: revenueClassOf(r.classification),
    classifier_version: r.classifierVersion,
    status: r.status,
    amount: r.amount,
    amount_refunded: r.amountRefunded,
    net: netOf(r),
    provider: r.provider,
    provider_label: providerLabel(r.provider),
    subscription_id: r.subscriptionId,
    refund_detected_at_utc: r.refundDetectedAt,
    refund_note: refundNote(r),
  };
}

const WALLET_COLUMNS = ["wallet_transaction_id", "settlement_time_utc", "settlement_time_denver", "denver_month", "scope_key", "scope_class", "scope_label", "account_id", "category", "cost_group", "description", "amount_as_stored"];
const WALLET_TEXT = ["scope_label", "description", "category"];

function walletRow(w: { id: string; scopeKey: string; ghlAccountId: string | null; settlementTime: Date; category: string; description: string; amount: string }, labelOf: (k: string) => string, hq: string | null): Row {
  return {
    wallet_transaction_id: w.id,
    settlement_time_utc: w.settlementTime,
    settlement_time_denver: denverStamp(w.settlementTime),
    denver_month: denverMonthOf(w.settlementTime),
    scope_key: w.scopeKey,
    scope_class: scopeClassOf(w.scopeKey, hq),
    scope_label: labelOf(w.scopeKey),
    account_id: w.ghlAccountId,
    category: w.category,
    cost_group: costGroupOf(w.category),
    description: w.description,
    amount_as_stored: w.amount,
  };
}

/** scopeKey → label text, for member locations, HQ, _agency and _unattributed. */
async function scopeLabeler(db: PrismaClient, hq: string | null): Promise<(k: string) => string> {
  const of = scopeLabelOf(await accountInfo(db), hq);
  return (k) => formatAccountLabel(of(k));
}

// ── the builder ─────────────────────────────────────────────────────────────

const fail = (status: number, message: string): BuiltExport => ({ ok: false, status, message });
const spec = (view: string, filters: Record<string, string>, columns: string[], textColumns: string[], chunks: AsyncIterable<Row[]>): CsvSpec => ({ view, filters, columns, textColumns, chunks, classifierVersion: CLASSIFIER_VERSION });

export async function buildExport(view: ExportView, db: PrismaClient, p: Params, ctx: Ctx): Promise<BuiltExport> {
  const detail = p.get("detail") === "1";
  const file = (suffix = "") => `reiblast-${view}${suffix ? `-${suffix}` : ""}-${ctx.now.toISOString().slice(0, 10)}.csv`;

  switch (view) {
    case "revenue": {
      const f = parseRevenueFilters(p, ctx.now);
      const ledger = await fetchLedgerRows(db, { fromMonth: f.fromMonth, toMonth: f.toMonth, accountId: f.accountId });
      const filters = { ...definedOnly(f), ...(detail ? { detail: "1" } : {}) };
      const rows = revenueDetail(ledger, f);
      if (detail) {
        const info = await accountInfo(db);
        return { ok: true, filename: file(detail ? "rows" : ""), spec: spec(view, filters, LEDGER_COLUMNS, LEDGER_TEXT, fromArray(rows.map((r) => ledgerRow(r, info, ctx.hq)))) };
      }
      const cells = new Map<string, { month: string; klass: string; count: number; net: string; ids: string[] }>();
      const netByCell = aggregateRevenue(ledger, f.fromMonth, f.toMonth);
      for (const m of netByCell.rows) for (const [k, c] of Object.entries(m.byClass)) if (c.count > 0 && (!f.klass || f.klass === k)) cells.set(`${m.month}|${k}`, { month: m.month, klass: k, count: c.count, net: c.net, ids: [] });
      for (const r of rows) cells.get(`${r.month}|${r.revenueClass}`)?.ids.push(r.ghlTransactionId);
      const out: Row[] = [...cells.values()].map((c) => ({ month: c.month, revenue_class: c.klass, class_label: CLASS_LABEL[c.klass as keyof typeof CLASS_LABEL], transaction_count: c.count, net_revenue: c.net, ghl_transaction_ids: c.ids.join(" ") }));
      return { ok: true, filename: file(), spec: spec(view, filters, ["month", "revenue_class", "class_label", "transaction_count", "net_revenue", "ghl_transaction_ids"], [], fromArray(out)) };
    }

    case "attempts": {
      const f = parseAttemptFilters(p, ctx.now);
      const ledger = await fetchLedgerRows(db, { fromMonth: f.fromMonth, toMonth: f.toMonth });
      const filters = { ...definedOnly(f), ...(detail ? { detail: "1" } : {}) };
      if (detail) {
        const info = await accountInfo(db);
        return { ok: true, filename: file("rows"), spec: spec(view, filters, LEDGER_COLUMNS, LEDGER_TEXT, fromArray(attemptsDetail(ledger, f).map((r) => ledgerRow(r, info, ctx.hq)))) };
      }
      const agg = aggregateAttempts(ledger, f);
      const out: Row[] = agg.rows.map((c) => ({ classification: c.classification, status: c.status, transaction_count: c.count, gross_attempted_amount: c.amount, ghl_transaction_ids: attemptsDetail(ledger, { ...f, classification: c.classification, status: c.status }).map((r) => r.ghlTransactionId).join(" ") }));
      return { ok: true, filename: file(), spec: spec(view, filters, ["classification", "status", "transaction_count", "gross_attempted_amount", "ghl_transaction_ids"], [], fromArray(out)) };
    }

    case "costs": {
      const f = parseCostFilters(p, ctx.now);
      const filters = { ...definedOnly(f), ...(detail ? { detail: "1" } : {}) };
      if (detail) {
        if (!f.month) return fail(400, "Raw transaction exports require a single month (month=YYYY-MM).");
        const label = await scopeLabeler(db, ctx.hq);
        async function* rows() { for await (const c of costDetailChunks(db, f, ctx.hq)) yield c.map((w) => walletRow(w, label, ctx.hq)); }
        return { ok: true, filename: file(`rows-${f.month}`), spec: spec(view, filters, WALLET_COLUMNS, WALLET_TEXT, rows()) };
      }
      const cells = await costCells(db, f, ctx.hq);
      const out: Row[] = cells.map((c) => ({ month: c.month, scope_class: c.scope, scope_label: SCOPE_LABEL[c.scope], cost_group: c.group, group_label: GROUP_LABEL[c.group], category: c.category, transaction_count: c.count, amount_as_stored: c.stored, amount_display: c.display, raw_rows_export: `costs?detail=1&month=${c.month}&scope=${c.scope}&category=${c.category}` }));
      return { ok: true, filename: file(), spec: spec(view, filters, ["month", "scope_class", "scope_label", "cost_group", "group_label", "category", "transaction_count", "amount_as_stored", "amount_display", "raw_rows_export"], ["scope_label", "category", "group_label"], fromArray(out)) };
    }

    case "margin": {
      const range = parseRange(p, ctx.now);
      const by = p.get("by") === "member" ? "member" : "agency";
      const { sort, dir } = parseMarginSort(p);
      const filters = { ...definedOnly(range), by, ...(by === "member" ? { sort, dir } : {}) };
      const ledger = await fetchLedgerRows(db, range);
      if (by === "agency") {
        const costs = summarizeCosts(await costCells(db, { ...range }, ctx.hq));
        const fee = parseFeePct((ctx.env ?? process.env).ADMIN_PROCESSOR_FEE_PCT);
        const m = buildAgencyMargin(aggregateRevenue(ledger, range.fromMonth, range.toMonth).rows, costs.byMonth, fee);
        const cols = ["month", "net_revenue_collected", "agency_cash_paid_to_ghl", "wallet_sales_tax", "gross_cash_margin", ...(fee ? ["processor_fee_estimate", "margin_after_fee_estimate"] : [])];
        const out: Row[] = m.rows.map((r) => ({ month: r.month, net_revenue_collected: r.netRevenue, agency_cash_paid_to_ghl: r.agencyCash, wallet_sales_tax: r.tax, gross_cash_margin: r.margin, processor_fee_estimate: r.feeEstimate, margin_after_fee_estimate: r.marginAfterFeeEstimate }));
        out.push({ month: "TOTAL", net_revenue_collected: m.totals.netRevenue, agency_cash_paid_to_ghl: m.totals.agencyCash, wallet_sales_tax: m.totals.tax, gross_cash_margin: m.totals.margin, processor_fee_estimate: m.totals.feeEstimate, margin_after_fee_estimate: m.totals.marginAfterFeeEstimate });
        return { ok: true, filename: file(), spec: spec(view, fee ? { ...filters, processor_fee_pct_estimate: fee } : filters, cols, [], fromArray(out)) };
      }
      const info = await accountInfo(db);
      const members = [...info.entries()].map(([accountId, i]) => ({ accountId, locationId: i.locationId }));
      const usage = await usageByScope(db, range, ctx.hq);
      const mm = buildMemberMargin(members, ledger, usage, range);
      const sorted = sortMemberMargin(mm.rows, sort, dir, (r) => acctLabel(info, r.accountId, ctx.hq));
      const out: Row[] = sorted.map((r) => ({ account_id: r.accountId, location_id: r.locationId, account_label: acctLabel(info, r.accountId, ctx.hq), wallet_recharges_collected: r.recharges, core_subscription_collected: r.core, other_collected: r.other, total_collected: r.collected, usage_charged: r.usage, usage_charge_count: r.usageCount, member_net: r.net, ledger_rows: r.ledgerRows }));
      out.push({ account_id: "", location_id: "", account_label: "Unmatched (ledger rows with no account)", wallet_recharges_collected: mm.unmatched.recharges, core_subscription_collected: mm.unmatched.core, other_collected: mm.unmatched.other, total_collected: mm.unmatched.collected, usage_charged: "0.000000", usage_charge_count: 0, member_net: mm.unmatched.collected, ledger_rows: mm.unmatched.ledgerRows });
      return { ok: true, filename: file("by-member"), spec: spec(view, filters, ["account_id", "location_id", "account_label", "wallet_recharges_collected", "core_subscription_collected", "other_collected", "total_collected", "usage_charged", "usage_charge_count", "member_net", "ledger_rows"], ["account_label"], fromArray(out)) };
    }

    case "members": {
      const { state, sort, dir } = parseMemberFilters(p);
      const { rows } = await loadMembers(db, ctx.hq, ctx.now);
      const label = (r: (typeof rows)[number]) => formatAccountLabel(accountLabel({ locationId: r.locationId, locationName: r.locationName, businessName: r.businessName }, ctx.hq));
      const sorted = sortMembers(rows.filter((r) => matchesState(r, state)), sort, dir, label);
      const out: Row[] = sorted.map((r) => ({
        account_id: r.accountId, location_id: r.locationId, account_label: label(r), billing_state: r.billingState ?? "not_seeded", pause_reason: r.pauseReason, legacy_unreconciled: r.legacyUnreconciled,
        covered_until: r.coveredUntil, coverage_note: r.coverageNote, expected_next_charge_estimate: r.expectedNextCharge, last_core_payment_utc: r.lastCorePaymentAt,
        strikes_live_pre_cutover: r.strikes, balance_status: r.balance?.status, balance: r.balance?.balance, balance_day: r.balance?.takenOn, usage_30d: r.usage30, recharges_30d: r.recharges30, trial_offer: r.trialOffer, trial_ends_at: r.trialEndsAt,
      }));
      const filters = definedOnly({ state, sort, dir });
      return { ok: true, filename: file(), spec: spec(view, filters, ["account_id", "location_id", "account_label", "billing_state", "pause_reason", "legacy_unreconciled", "covered_until", "coverage_note", "expected_next_charge_estimate", "last_core_payment_utc", "strikes_live_pre_cutover", "balance_status", "balance", "balance_day", "usage_30d", "recharges_30d", "trial_offer", "trial_ends_at"], ["account_label", "pause_reason", "coverage_note", "trial_offer"], fromArray(out)) };
    }

    case "member-ledger": {
      const id = parseMemberId(p);
      if (!id) return fail(400, "member=<account id> is required.");
      const info = await accountInfo(db);
      if (!info.has(id)) return fail(404, "Unknown member account.");
      const ledger = await fetchLedgerRows(db, { accountId: id });
      return { ok: true, filename: file(id.slice(-4)), spec: spec(view, { member: id }, LEDGER_COLUMNS, LEDGER_TEXT, fromArray(ledger.map((r) => ledgerRow(r, info, ctx.hq)))) };
    }

    case "member-usage": {
      const id = parseMemberId(p);
      const f = parseCostFilters(p, ctx.now);
      if (!id) return fail(400, "member=<account id> is required.");
      if (!f.month) return fail(400, "Raw transaction exports require a single month (month=YYYY-MM).");
      const info = await accountInfo(db);
      const loc = info.get(id)?.locationId;
      if (!loc) return fail(404, "Unknown member account or no location yet.");
      const label = await scopeLabeler(db, ctx.hq);
      const where = costWhere({ ...f, scopeKey: loc }, ctx.hq);
      async function* rows() { for await (const c of walletChunks(db, where)) yield c.map((w) => walletRow(w, label, ctx.hq)); }
      return { ok: true, filename: file(`${id.slice(-4)}-${f.month}`), spec: spec(view, { member: id, month: f.month }, WALLET_COLUMNS, WALLET_TEXT, rows()) };
    }
  }
}
