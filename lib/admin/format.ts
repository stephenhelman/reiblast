export const REPORTING_TZ = "America/Denver";
export const FOOTER_NOTE = "Gross collected via GHL — processor fees, chargebacks and payouts not included. Reporting timezone: America/Denver.";

export function fmtDenver(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: REPORTING_TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export const fmtMb = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`);
export const fmtUsd = (s: string | number): string => Number(s).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
export const last4 = (s: string): string => `…${s.slice(-4)}`;
