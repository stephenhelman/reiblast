/**
 * Actual Kurv statements for the two reference months before the partner statement starts (2026-10-01), plus the opening
 * reserve. Reference only: nothing before October counts toward what is owed. Daily fees include the discount.
 */
export const KURV_REFERENCE_STATEMENTS = [
  { month: "2026-08", salesCount: 47, salesAmountCents: 94971, dailyFeesPaidCents: 4341, reserveFundedCents: 9498, monthlyDebitCents: 6607, notes: "Reference only. First month: fixed monthly fees were not billed." },
  { month: "2026-09", salesCount: 194, salesAmountCents: 419512, dailyFeesPaidCents: 18831, reserveFundedCents: 41953, monthlyDebitCents: 17656, notes: "Reference only. Debit posted 2026-10-01." },
] as const;

/** Reserve fund balance at 2026-09-30 (= Aug + Sep reserve funded). Stored as a ReserveMovement adjustment. */
export const OPENING_RESERVE = { date: "2026-09-30", amountCents: 51451, note: "Opening balance" } as const;

/** Rates and fixed costs effective with the first statement month. */
export const STATEMENT_START = "2026-10-01";

export const SEED_RATES: readonly { key: string; value: string; note: string }[] = [
  { key: "kurv_discount_rate", value: "0.029", note: "Discount rate on gross" },
  { key: "kurv_per_item", value: "0.20", note: "Per non-Amex item, dollars" },
  { key: "kurv_per_batch", value: "0.35", note: "Per batch, dollars" },
  { key: "kurv_interchange_rate", value: "0.0044", note: "Interchange/downgrade estimate on gross (calibrated)" },
  { key: "kurv_reserve_rate", value: "0.10", note: "Reserve share of gross" },
  { key: "kurv_per_auth", value: "0.20", note: "Monthly: per authorization attempt, dollars" },
  { key: "kurv_per_avs", value: "0.10", note: "Monthly: per AVS check, dollars (estimate)" },
  { key: "kurv_avs_per_auth_ratio", value: "0.72", note: "ESTIMATE: AVS checks per authorization (Sep 2026: 280/389)" },
  { key: "kurv_brand_fee_rate", value: "0.006", note: "Monthly: card-brand fees on volume (estimate)" },
  { key: "kurv_fixed_monthly", value: "43.20", note: "$29 access + $5.95 breach + $7 Visa FANF + $1.25 MC location" },
  { key: "partner_split_pct", value: "0.50", note: "Stephen's share of the statement net" },
];

export const SEED_FIXED_COSTS: readonly { name: string; monthlyAmountCents: number }[] = [
  { name: "ghl_agency_plan", monthlyAmountCents: 49700 },
  { name: "authorize_net", monthlyAmountCents: 2500 },
];
