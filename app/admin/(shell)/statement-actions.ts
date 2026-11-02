"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { logAdmin, clientIp } from "@/lib/admin/audit";
import { adminBase } from "@/lib/admin/cookie";
import { adminHref } from "@/lib/admin/links";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";
import { parseFixedCost, parseKurvStatement, parsePayment, parseRate, parseReserveMovement, type Parsed } from "@/lib/admin/statementForms";
import { getBillingDb } from "@/lib/billing/db";
import { isMonth } from "@/lib/billing/reports/denver";
import { canCloseMonth } from "@/lib/billing/statement/close";
import { computeLiveStatement } from "@/lib/billing/statement/compute";

// Every action: owner check first (server actions are public POST endpoints), validate, write, audit, redirect back with a notice.
type Back = { path: string; params?: Record<string, string> };

async function done(back: Back, kind: "notice" | "error", message: string): Promise<never> {
  redirect(adminHref(await adminBase(), back.path, { ...(back.params ?? {}), [kind]: message }));
}

async function guarded<T>(back: Back, parsed: Parsed<T>): Promise<T> {
  if (!parsed.ok) return done(back, "error", parsed.error);
  return parsed.value;
}

const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const monthBack = (path: string, f: FormData): Back => {
  const m = String(f.get("month") ?? "");
  return { path, params: isMonth(m) ? { month: m } : {} };
};
async function audit(what: string, detail: Record<string, unknown>) {
  await logAdmin(await getBillingDb(), "statement_change", { what, ...detail }, clientIp(await headers()));
}

export async function recordPaymentAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back = monthBack("/", f);
  const v = await guarded(back, parsePayment(f));
  const row = await (await getBillingDb()).partnerPayment.create({ data: { date: asDate(v.date), amountCents: v.amountCents, note: v.note } });
  await audit("payment_recorded", { id: row.id, amountCents: v.amountCents, date: v.date });
  await done(back, "notice", "Payment recorded.");
}

export async function closeMonthAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back = monthBack("/", f);
  const month = String(f.get("month") ?? "");
  if (!isMonth(month)) return done(back, "error", "Invalid month.");
  const db = await getBillingDb();
  const now = new Date();
  const existing = await db.monthClose.findUnique({ where: { month } });
  const check = canCloseMonth({
    month,
    now,
    hasKurvStatement: !!(await db.kurvStatement.findUnique({ where: { month } })),
    alreadyClosed: !!existing && !existing.reopenedAt,
    walletRefresh: await db.walletMonthRefresh.findUnique({ where: { month }, select: { windowsDone: true, windowsTotal: true, completedAt: true } }),
  });
  if (!check.ok) return done(back, "error", check.reason);
  // Snapshot the live statement (the closed-month shortcut is skipped on purpose: this month isn't closed yet).
  const snapshot = await computeLiveStatement(db, month, { now });
  const data = { closedAt: now, snapshot: snapshot as unknown as Prisma.InputJsonObject, owedAmountCents: snapshot.owedCents, reopenedAt: null };
  await db.monthClose.upsert({ where: { month }, create: { month, ...data }, update: data });
  await audit("month_closed", { month, owedAmountCents: snapshot.owedCents });
  await done(back, "notice", `${month} closed. Owed ${(snapshot.owedCents / 100).toFixed(2)}.`);
}

export async function reopenMonthAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back = monthBack("/", f);
  const month = String(f.get("month") ?? "");
  if (!isMonth(month)) return done(back, "error", "Invalid month.");
  // Explicit confirm: tick the box AND type the month.
  if (f.get("confirm") !== "on" || String(f.get("typed") ?? "").trim() !== month) return done(back, "error", `To reopen, tick the box and type ${month}.`);
  const db = await getBillingDb();
  const res = await db.monthClose.updateMany({ where: { month, reopenedAt: null }, data: { reopenedAt: new Date() } });
  if (res.count === 0) return done(back, "error", "That month isn't closed.");
  await audit("month_reopened", { month });
  await done(back, "notice", `${month} reopened. It will be recomputed live until closed again.`);
}

export async function saveKurvStatementAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back = monthBack("/cash", f);
  const v = await guarded(back, parseKurvStatement(f));
  const db = await getBillingDb();
  const closed = await db.monthClose.findUnique({ where: { month: v.month } });
  if (closed && !closed.reopenedAt) return done(back, "error", `${v.month} is closed. Reopen it on the Partner Statement to change its Kurv figures.`);
  const { month, ...rest } = v;
  await db.kurvStatement.upsert({ where: { month }, create: { month, ...rest }, update: { ...rest, enteredAt: new Date() } });
  await audit("kurv_statement_saved", { month, ...rest });
  await done(back, "notice", `Kurv statement for ${month} saved. The statement now uses these actuals.`);
}

export async function addReserveMovementAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back = monthBack("/cash", f);
  const v = await guarded(back, parseReserveMovement(f));
  const month = v.date.slice(0, 7);
  const db = await getBillingDb();
  const closed = await db.monthClose.findUnique({ where: { month } });
  if (closed && !closed.reopenedAt) return done(back, "error", `${month} is closed; a reserve movement dated in it would change a frozen month. Reopen it first.`);
  const row = await db.reserveMovement.create({ data: { date: asDate(v.date), kind: v.kind, amountCents: v.amountCents, note: v.note } });
  await audit("reserve_movement", { id: row.id, kind: v.kind, amountCents: v.amountCents, date: v.date });
  await done(back, "notice", "Reserve movement recorded.");
}

export async function addRateAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back: Back = { path: "/settings" };
  const v = await guarded(back, parseRate(f));
  const db = await getBillingDb();
  const month = v.effectiveFrom.slice(0, 7);
  const closed = await db.monthClose.findFirst({ where: { reopenedAt: null, month: { gte: month } } });
  if (closed) return done(back, "error", `Closed month ${closed.month} would be affected by a rate effective ${v.effectiveFrom}. Closed months keep their snapshot, but reopen first if that isn't intended.`);
  try {
    await db.settingRate.create({ data: { key: v.key, value: v.value, effectiveFrom: asDate(v.effectiveFrom), note: v.note } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return done(back, "error", `${v.key} already has a row effective ${v.effectiveFrom}. History isn't edited; add a row with a later date.`);
    throw e;
  }
  await audit("rate_added", v);
  await done(back, "notice", `${v.key} = ${v.value} effective ${v.effectiveFrom}.`);
}

export async function addFixedCostAction(f: FormData): Promise<void> {
  await requireOwnerOrRedirect();
  const back: Back = { path: "/settings" };
  const v = await guarded(back, parseFixedCost(f));
  const db = await getBillingDb();
  try {
    await db.fixedCost.create({ data: { name: v.name, monthlyAmountCents: v.monthlyAmountCents, effectiveFrom: asDate(v.effectiveFrom) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return done(back, "error", `${v.name} already has a row effective ${v.effectiveFrom}. Add a row with a later date.`);
    throw e;
  }
  await audit("fixed_cost_added", v);
  await done(back, "notice", `${v.name} $${(v.monthlyAmountCents / 100).toFixed(2)}/mo effective ${v.effectiveFrom}.`);
}
