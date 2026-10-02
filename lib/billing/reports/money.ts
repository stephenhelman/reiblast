import { Prisma } from "@prisma/client";

/** Exact decimal arithmetic on money strings — no floats anywhere in the reports. */
export type Money = string;
const D = Prisma.Decimal;

export const dec = (v: string | number | Prisma.Decimal | null | undefined): Prisma.Decimal => new D(v === null || v === undefined || v === "" ? 0 : (v as never));
export const ZERO: Money = "0.000000";
export const norm = (v: Money | Prisma.Decimal): Money => dec(v).toFixed(6);
export const add = (a: Money, b: Money): Money => dec(a).plus(dec(b)).toFixed(6);
export const sub = (a: Money, b: Money): Money => dec(a).minus(dec(b)).toFixed(6);
export const neg = (a: Money): Money => dec(a).neg().toFixed(6);
export const sumOf = (xs: Money[]): Money => xs.reduce((s, x) => s.plus(dec(x)), dec(0)).toFixed(6);
export const isZero = (a: Money): boolean => dec(a).isZero();
export const isNeg = (a: Money): boolean => dec(a).isNegative() && !dec(a).isZero();
export const cmp = (a: Money, b: Money): number => dec(a).comparedTo(dec(b));
/** pct is a percentage string/number, e.g. "2.9" → 2.9%. */
export const pctOf = (a: Money, pct: string | number): Money => dec(a).times(dec(pct)).dividedBy(100).toFixed(6);

/** Display: "$1,234.56" / "-$1,234.56" from a money string (rounded half-up to `dp`). */
export function fmtMoney(a: Money | null | undefined, dp = 2): string {
  if (a === null || a === undefined) return "—";
  const d = dec(a);
  const fixed = d.abs().toFixed(dp, Prisma.Decimal.ROUND_HALF_UP);
  const [w, f] = fixed.split(".");
  const withCommas = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shownZero = new D(fixed).isZero(); // never print "-$0.00"
  return `${d.isNegative() && !shownZero ? "-" : ""}$${withCommas}${f ? `.${f}` : ""}`;
}

/** For plotting ONLY (recharts needs numbers). Never used for arithmetic. */
export const toPlot = (a: Money): number => Number(dec(a).toFixed(2));
