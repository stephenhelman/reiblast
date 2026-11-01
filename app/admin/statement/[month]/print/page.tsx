import { notFound } from "next/navigation";
import React from "react";
import { pageCtx } from "@/lib/admin/pageCtx";
import { currentDenverMonth, isMonth } from "@/lib/billing/reports/denver";
import { computeMonthStatement, FIRST_STATEMENT_MONTH, outstandingBalance } from "@/lib/billing/statement/compute";
import { MissingRateError } from "@/lib/billing/kurv/rates";
import { StatementPrintDocument } from "./StatementPrintDocument";

export const dynamic = "force-dynamic";
export const metadata = { title: "REIblast Partner Statement" };

/** Owner-only (pageCtx → requireOwnerOrRedirect). A dedicated print document: no nav, buttons, stale banner or freshness stamps. */
export default async function StatementPrintPage({ params, searchParams }: { params: { month: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const { db, hq, now } = await pageCtx();
  const month = params.month;
  if (!isMonth(month) || month < FIRST_STATEMENT_MONTH || month > currentDenverMonth(now)) notFound();

  let s;
  try {
    s = await computeMonthStatement(db, month, { now, hq });
  } catch (e) {
    if (e instanceof MissingRateError) notFound();
    throw e;
  }
  const [out, payments] = await Promise.all([outstandingBalance(db), db.partnerPayment.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 10 })]);
  return <StatementPrintDocument s={s} month={month} out={out} payments={payments} now={now} autoprint={!!searchParams.autoprint} />;
}
