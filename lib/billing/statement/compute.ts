import { Prisma, type PrismaClient } from "@prisma/client";
import { isAmexBrand, type Batch } from "../kurv/batch";
import { addDays } from "../kurv/calendar";
import { estimateMonthlyDebit, sumBatchFees, type MonthlyActivity } from "../kurv/fees";
import { kurvRatesAsOf, MissingRateError, rateAsOf } from "../kurv/rates";
import { STATEMENT_START } from "../kurv/reference";
import { movementDelta } from "../kurv/reserve";
import { addMonths, currentDenverMonth, denverDayOf, denverMonthStart, isMonth, sqlDenverMonth } from "../reports/denver";
import { assembleStatement, roundBreakdown } from "./assemble";
import type { MonthStatement, WalletDetail } from "./types";

export type StatementDb = Pick<PrismaClient, "billingLedgerEntry" | "settingRate" | "fixedCost" | "kurvStatement" | "reserveMovement" | "partnerPayment" | "monthClose" | "$queryRaw">;

export const FIRST_STATEMENT_MONTH = STATEMENT_START.slice(0, 7);
const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Debit rows that are the agency plan itself (so the fixed $497 isn't counted twice if GHL also posts it to the wallet). */
const PLAN_ROW = Prisma.sql`(ROUND("amount", 2) = -497.00 OR "description" ~* '(agency|saas|pro).{0,20}(plan|subscription)')`;

export async function loadBatches(db: Pick<StatementDb, "billingLedgerEntry">, month: string): Promise<Batch[]> {
  const rows = await db.billingLedgerEntry.findMany({
    where: { batchDate: { not: null }, expectedDepositDate: { gte: asDate(`${month}-01`), lt: asDate(`${addMonths(month, 1)}-01`) } },
    select: { batchWindowStart: true, batchDate: true, expectedDepositDate: true, settleAmountCents: true, cardBrand: true },
  });
  const by = new Map<number, Batch>();
  for (const r of rows) {
    const key = r.batchWindowStart!.getTime();
    let b = by.get(key);
    if (!b) {
      b = { windowEnd: addDays(denverDayOf(r.batchWindowStart!), 1), windowStart: r.batchWindowStart!, batchDate: day(r.batchDate!), depositDate: day(r.expectedDepositDate!), items: 0, nonAmexItems: 0, grossCents: 0 };
      by.set(key, b);
    }
    b.items++;
    if (!isAmexBrand(r.cardBrand)) b.nonAmexItems++;
    b.grossCents += r.settleAmountCents ?? 0;
  }
  return [...by.values()].sort((a, b) => (a.windowEnd < b.windowEnd ? -1 : 1));
}

async function loadActivity(db: Pick<StatementDb, "billingLedgerEntry">, month: string): Promise<Omit<MonthlyActivity, "volumeCents">> {
  const g = await db.billingLedgerEntry.groupBy({
    by: ["transactionType"],
    where: { submitTimeUtc: { gte: denverMonthStart(month), lt: denverMonthStart(addMonths(month, 1)) }, chargeId: { notIn: ["0"] } },
    _count: { _all: true },
  });
  const n = (t: string) => g.find((x) => x.transactionType === t)?._count._all ?? 0;
  return { captureAttempts: n("authCaptureTransaction"), authOnlyCount: n("authOnlyTransaction") };
}

async function loadWallet(db: Pick<StatementDb, "$queryRaw">, month: string, hq: string | null): Promise<WalletDetail> {
  const bucket = Prisma.raw(sqlDenverMonth('"settlementTime"'));
  const scope = Prisma.sql`(CASE WHEN "scopeKey" = ${hq ?? ""} AND ${hq ? 1 : 0} = 1 THEN 'hq' WHEN "scopeKey" = '_agency' THEN 'agency' WHEN "scopeKey" = '_unattributed' THEN 'unattributed' ELSE 'member' END)`;
  const micros = Prisma.sql`SUM(("amount" * 1000000)::bigint)::text`;
  const debits = await db.$queryRaw<{ scope: "member" | "hq" | "agency" | "unattributed"; category: string; n: number; m: string }[]>`
    SELECT ${scope} AS "scope", "category", COUNT(*)::int AS "n", ${micros} AS "m" FROM "WalletTransaction"
    WHERE ${bucket} = ${month} AND "amount" < 0 AND NOT ${PLAN_ROW} GROUP BY 1, 2 ORDER BY 1, 2`;
  const [credits] = await db.$queryRaw<{ m: string | null }[]>`
    SELECT ${micros} AS "m" FROM "WalletTransaction" WHERE ${bucket} = ${month} AND "amount" > 0`;
  const [plan] = await db.$queryRaw<{ n: number; m: string | null }[]>`
    SELECT COUNT(*)::int AS "n", ${micros} AS "m" FROM "WalletTransaction" WHERE ${bucket} = ${month} AND "amount" < 0 AND ${PLAN_ROW}`;
  const [any] = await db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS "n" FROM "WalletTransaction" WHERE ${bucket} = ${month}`;
  const r = roundBreakdown(debits.map((x) => ({ category: x.category, scope: x.scope, count: x.n, micros: Number(x.m) })));
  const centsOf = (m: string | null) => Math.round(Number(m ?? 0) / 10000);
  return {
    debitCount: debits.reduce((s, x) => s + x.n, 0),
    // Debits are stored negative; the statement carries cost magnitudes.
    breakdown: r.rows.map((x) => ({ ...x, cents: -x.cents })),
    rechargeCreditsCents: centsOf(credits?.m ?? null),
    planRowsExcluded: { count: plan?.n ?? 0, cents: -centsOf(plan?.m ?? null) },
    hasData: (any?.n ?? 0) > 0,
  };
}

const prevMonth = (m: string) => addMonths(m, -1);

/** Reserve funded by a month's deposits: the entered Kurv figure if there is one, else 10% of batch gross. */
async function monthFunded(db: StatementDb, month: string, rates: ReturnType<typeof kurvRatesAsOf>): Promise<number> {
  const actual = await db.kurvStatement.findUnique({ where: { month } });
  if (actual) return actual.reserveFundedCents;
  return sumBatchFees(await loadBatches(db, month), rates).reserveCents;
}

/**
 * Company reserve fund balance at the END of `month` (default: current Denver month). Opening movements (dated before the
 * statement start, i.e. the 2026-09-30 opening balance) + reserve funded by each month's deposits from October on ± every
 * recorded movement. Never touched by the 50% split.
 */
export async function reserveBalance(db: StatementDb, month: string = currentDenverMonth()): Promise<number> {
  const moves = await db.reserveMovement.findMany();
  const rateRows = await db.settingRate.findMany();
  const before = (m: (typeof moves)[number]) => day(m.date) < STATEMENT_START;
  let bal = moves.filter(before).reduce((s, m) => s + movementDelta({ kind: m.kind, amountCents: m.amountCents }), 0);
  for (let m = FIRST_STATEMENT_MONTH; m <= month; m = addMonths(m, 1)) {
    bal += await monthFunded(db, m, kurvRatesAsOf(rateRows, `${m}-01`));
    bal += moves.filter((x) => !before(x) && day(x.date).startsWith(m)).reduce((s, x) => s + movementDelta({ kind: x.kind, amountCents: x.amountCents }), 0);
  }
  return bal;
}

export type ComputeOpts = { now?: Date; hq?: string | null; /** Ignore an entered KurvStatement and show the pure estimate (variance view). */ forceEstimate?: boolean };

/** The live (never snapshot) statement for one Denver month. */
export async function computeLiveStatement(db: StatementDb, month: string, opts: ComputeOpts = {}): Promise<MonthStatement> {
  if (!isMonth(month)) throw new Error(`Invalid month "${month}".`);
  if (month < FIRST_STATEMENT_MONTH) throw new Error(`The statement starts ${STATEMENT_START}; ${month} is not part of it.`);
  const now = opts.now ?? new Date();
  const first = `${month}-01`, nextFirst = `${addMonths(month, 1)}-01`;
  const rateRows = await db.settingRate.findMany();
  const rates = kurvRatesAsOf(rateRows, first);
  const batches = await loadBatches(db, month);
  const activity = await loadActivity(db, month);
  const kurv = opts.forceEstimate ? null : await db.kurvStatement.findUnique({ where: { month } });
  const costs = await db.fixedCost.findMany({ where: { effectiveFrom: { lt: asDate(nextFirst) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asDate(first) } }] }, orderBy: { effectiveFrom: "asc" } });
  const latest = new Map(costs.map((c) => [c.name, c.monthlyAmountCents])); // ascending → last (latest) wins
  const moves = (await db.reserveMovement.findMany({ where: { date: { gte: asDate(first), lt: asDate(nextFirst) } } })).map((m) => ({ kind: m.kind, amountCents: m.amountCents }));

  return assembleStatement({
    month,
    batches,
    activity: { ...activity, volumeCents: 0 },
    rates,
    splitPct: rateAsOf(rateRows, "partner_split_pct", first),
    kurvActual: kurv && { salesCount: kurv.salesCount, salesAmountCents: kurv.salesAmountCents, dailyFeesPaidCents: kurv.dailyFeesPaidCents, reserveFundedCents: kurv.reserveFundedCents, monthlyDebitCents: kurv.monthlyDebitCents },
    fixedCosts: [...latest].map(([name, cents]) => ({ name, cents })),
    wallet: await loadWallet(db, month, opts.hq === undefined ? process.env.GHL_HQ_LOCATION_ID ?? null : opts.hq),
    reserveMovements: moves,
    reserveOpeningCents: await reserveBalance(db, prevMonth(month)),
    partial: now < denverMonthStart(addMonths(month, 1)),
    now,
  });
}

/**
 * The statement for one Denver month (the Kurv deposit month). A closed month returns its stored snapshot untouched; any
 * other month is computed live from the ledger, dated settings and wallet rows.
 */
export async function computeMonthStatement(db: StatementDb, month: string, opts: ComputeOpts = {}): Promise<MonthStatement> {
  if (!isMonth(month)) throw new Error(`Invalid month "${month}".`);
  if (month < FIRST_STATEMENT_MONTH) throw new Error(`The statement starts ${STATEMENT_START}; ${month} is not part of it.`);
  const closed = await db.monthClose.findUnique({ where: { month } });
  if (closed && !closed.reopenedAt) return { ...(closed.snapshot as unknown as MonthStatement), closed: true, closedAt: closed.closedAt.toISOString() };
  return computeLiveStatement(db, month, opts);
}

/** Kurv's total cost for a month in cents (daily fees incl. discount + monthly debit), estimate or actual. No wallet/reserve queries. */
export async function kurvFeesCents(db: StatementDb, month: string): Promise<number | null> {
  if (month < FIRST_STATEMENT_MONTH) return null;
  const rateRows = await db.settingRate.findMany();
  const kurv = await db.kurvStatement.findUnique({ where: { month } });
  if (kurv) return kurv.dailyFeesPaidCents + kurv.monthlyDebitCents;
  try {
    const rates = kurvRatesAsOf(rateRows, `${month}-01`);
    const f = sumBatchFees(await loadBatches(db, month), rates);
    const debit = estimateMonthlyDebit({ ...(await loadActivity(db, month)), volumeCents: f.grossCents }, rates);
    return f.discountCents + f.otherFeesCents + debit.totalCents;
  } catch (e) {
    if (e instanceof MissingRateError) return null; // not seeded: margin simply shows no modeled fee
    throw e;
  }
}

/** Σ owed for closed months − Σ payments received from the partner. Open months never count. */
export async function outstandingBalance(db: Pick<StatementDb, "monthClose" | "partnerPayment">): Promise<{ owedClosedCents: number; paidCents: number; outstandingCents: number }> {
  const closed = await db.monthClose.aggregate({ where: { reopenedAt: null }, _sum: { owedAmountCents: true } });
  const paid = await db.partnerPayment.aggregate({ _sum: { amountCents: true } });
  const owedClosedCents = closed._sum.owedAmountCents ?? 0;
  const paidCents = paid._sum.amountCents ?? 0;
  return { owedClosedCents, paidCents, outstandingCents: owedClosedCents - paidCents };
}
