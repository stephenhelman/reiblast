import { isMonth } from "@/lib/billing/reports/denver";
import { KURV_RATE_KEYS } from "@/lib/billing/kurv/rates";
import { FIRST_STATEMENT_MONTH } from "@/lib/billing/statement/compute";

/** Pure parsing/validation for the statement forms. Each returns the cleaned value or an error string; nothing throws. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Form = { get(name: string): FormDataEntryValue | null };

const text = (f: Form, k: string): string => String(f.get(k) ?? "").trim();
const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const err = (error: string): Parsed<never> => ({ ok: false, error });

/** "1,234.56" / "$12" → integer cents. At most 2 decimals; sign allowed only when `signed`. */
export function parseCents(raw: string, opts: { signed?: boolean } = {}): number | null {
  const m = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m || (m[1] && !opts.signed)) return null;
  const cents = Number(m[2].replace(/,/g, "")) * 100 + Number((m[3] ?? "").padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

export const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const firstOfMonth = (s: string): boolean => isDay(s) && s.endsWith("-01");

export function parsePayment(f: Form): Parsed<{ date: string; amountCents: number; note: string | null }> {
  const date = text(f, "date");
  const amountCents = parseCents(text(f, "amount"));
  if (!isDay(date)) return err("Enter the date the payment was received.");
  if (!amountCents || amountCents <= 0) return err("Enter a payment amount greater than $0.00.");
  return ok({ date, amountCents, note: text(f, "note").slice(0, 300) || null });
}

export function parseKurvStatement(f: Form) {
  const month = text(f, "month");
  if (!isMonth(month) || month < FIRST_STATEMENT_MONTH) return err(`Month must be ${FIRST_STATEMENT_MONTH} or later.`);
  const salesCount = /^\d{1,6}$/.test(text(f, "salesCount")) ? Number(text(f, "salesCount")) : null;
  if (salesCount === null) return err("Sales count must be a whole number.");
  const money = (k: string, label: string, allowZero = true): number | string => {
    const v = parseCents(text(f, k));
    return v === null || v < 0 || (!allowZero && v === 0) ? `${label} must be a dollar amount (0.00 or more).` : v;
  };
  const fields = { salesAmountCents: money("salesAmount", "Sales amount"), dailyFeesPaidCents: money("dailyFeesPaid", "Daily fees paid (including discount)"), reserveFundedCents: money("reserveFunded", "Reserve funded"), reserveReleasedCents: money("reserveReleased", "Reserve released"), monthlyDebitCents: money("monthlyDebit", "Monthly debit") };
  for (const v of Object.values(fields)) if (typeof v === "string") return err(v);
  const f2 = fields as Record<keyof typeof fields, number>;
  if (f2.dailyFeesPaidCents + f2.reserveFundedCents > f2.salesAmountCents) return err("Daily fees plus reserve can't exceed sales.");
  return ok({ month, salesCount, ...f2, notes: text(f, "notes").slice(0, 500) || null });
}

export function parseReserveMovement(f: Form): Parsed<{ date: string; kind: "release" | "withdrawal" | "adjustment"; amountCents: number; note: string | null }> {
  const date = text(f, "date");
  const kind = text(f, "kind");
  if (!isDay(date)) return err("Enter a date.");
  if (kind !== "release" && kind !== "withdrawal" && kind !== "adjustment") return err("Choose release, withdrawal or adjustment.");
  const amountCents = parseCents(text(f, "amount"), { signed: kind === "adjustment" });
  if (amountCents === null || amountCents === 0 || (kind !== "adjustment" && amountCents < 0)) return err(kind === "adjustment" ? "Enter a non-zero adjustment (negative to reduce the fund)." : "Enter an amount greater than $0.00.");
  const note = text(f, "note").slice(0, 300) || null;
  if (!note && kind !== "release") return err("A note is required for withdrawals and adjustments.");
  return ok({ date, kind, amountCents, note });
}

export const RATE_KEYS: readonly string[] = [...Object.values(KURV_RATE_KEYS), "partner_split_pct"];

export function parseRate(f: Form): Parsed<{ key: string; value: string; effectiveFrom: string; note: string | null }> {
  const key = text(f, "key");
  const value = text(f, "value");
  const effectiveFrom = text(f, "effectiveFrom");
  if (!RATE_KEYS.includes(key)) return err("Unknown rate.");
  if (!/^\d{1,6}(\.\d{1,8})?$/.test(value)) return err("Value must be a non-negative number (up to 8 decimals).");
  if (!firstOfMonth(effectiveFrom)) return err("Effective date must be the 1st of a month (statements pick rates as of the month's first day).");
  if (key === "partner_split_pct" || key.endsWith("_rate") || key === "kurv_avs_per_auth_ratio") if (Number(value) > 1) return err("Rates and ratios are fractions (0.029 = 2.9%).");
  return ok({ key, value, effectiveFrom, note: text(f, "note").slice(0, 200) || null });
}

export function parseFixedCost(f: Form): Parsed<{ name: string; monthlyAmountCents: number; effectiveFrom: string }> {
  const name = text(f, "name");
  const monthlyAmountCents = parseCents(text(f, "amount"));
  const effectiveFrom = text(f, "effectiveFrom");
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) return err("Name: lowercase letters, digits and underscores (e.g. ghl_agency_plan).");
  if (monthlyAmountCents === null || monthlyAmountCents < 0) return err("Enter a monthly amount (0.00 ends a cost).");
  if (!firstOfMonth(effectiveFrom)) return err("Effective date must be the 1st of a month.");
  return ok({ name, monthlyAmountCents, effectiveFrom });
}
