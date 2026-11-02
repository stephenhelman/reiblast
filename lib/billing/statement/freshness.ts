import type { MonthStatement } from "./types";

export const STALE_AFTER_MS = 26 * 3600_000;

export type Freshness = {
  /** Most recent BillingLedgerEntry write (webhook or sweep). */
  ledgerAt: Date | null;
  /** Most recent WalletTransaction.settlementTime, and when the newest row was inserted. */
  walletLastRowAt: Date | null;
  walletIngestedAt: Date | null;
  kurvEnteredAt: Date | null;
};

export type StaleSource = { key: "ledger" | "wallet"; label: string; asOf: Date | null };

/** Ledger and wallet are the live sources; one older than 26h (or absent) is stale. */
export function staleSources(f: Freshness, now: Date): StaleSource[] {
  const out: StaleSource[] = [];
  const old = (d: Date | null) => !d || now.getTime() - d.getTime() > STALE_AFTER_MS;
  if (old(f.ledgerAt)) out.push({ key: "ledger", label: "Payments ledger", asOf: f.ledgerAt });
  if (old(f.walletIngestedAt)) out.push({ key: "wallet", label: "GHL wallet usage", asOf: f.walletIngestedAt });
  return out;
}

export type DataThrough = { text: string; at: Date | null };

/** What each statement line's number is current through, in words. */
export function lineDataThrough(s: MonthStatement, f: Freshness): Record<string, DataThrough> {
  const frozen = s.closedAt ? { text: "Frozen at close", at: new Date(s.closedAt) } : null;
  const kurv: DataThrough = { text: "Kurv statement entered", at: f.kurvEnteredAt };
  return {
    deposits: frozen ?? (s.deposits.basis === "actual" ? kurv : { text: "Ledger last ingest", at: f.ledgerAt }),
    monthly_debit: frozen ?? (s.monthlyDebit.basis === "actual" ? kurv : { text: "Estimate from ledger activity through", at: f.ledgerAt }),
    agency_plan: frozen ?? { text: "Dated setting (no feed)", at: null },
    authorize_net: frozen ?? { text: "Dated setting (no feed)", at: null },
    agency_wallet: frozen ?? { text: s.wallet.hasData ? "Wallet last row" : "No wallet rows loaded", at: f.walletLastRowAt },
  };
}
