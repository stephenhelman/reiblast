import type { KurvRates } from "./fees";

export type RateRow = { key: string; value: number | string | { toString(): string }; effectiveFrom: Date | string };

/** SettingRate keys behind KurvRates. */
export const KURV_RATE_KEYS = {
  discountRate: "kurv_discount_rate",
  perItem: "kurv_per_item",
  perBatch: "kurv_per_batch",
  interchangeRate: "kurv_interchange_rate",
  reserveRate: "kurv_reserve_rate",
  perAuth: "kurv_per_auth",
  perAvs: "kurv_per_avs",
  avsPerAuthRatio: "kurv_avs_per_auth_ratio",
  brandFeeRate: "kurv_brand_fee_rate",
  fixedMonthly: "kurv_fixed_monthly",
} as const satisfies Record<keyof KurvRates, string>;

const day = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

/** Latest value per key with effectiveFrom <= asOf ("YYYY-MM-DD"). Throws on a missing key rather than guessing a default. */
export function rateAsOf(rows: readonly RateRow[], key: string, asOf: string): number {
  let best: RateRow | undefined;
  for (const r of rows) if (r.key === key && day(r.effectiveFrom) <= asOf && (!best || day(r.effectiveFrom) > day(best.effectiveFrom))) best = r;
  if (!best) throw new Error(`SettingRate "${key}" has no value effective on or before ${asOf}.`);
  return Number(best.value.toString());
}

export function kurvRatesAsOf(rows: readonly RateRow[], asOf: string): KurvRates {
  const out = {} as Record<string, number>;
  for (const [field, key] of Object.entries(KURV_RATE_KEYS)) out[field] = rateAsOf(rows, key, asOf);
  return out as unknown as KurvRates;
}
