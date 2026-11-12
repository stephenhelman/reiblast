import { LIST_TYPES } from "@/lib/leadCleaner";

/**
 * Campaign + variant registry for the scorecard. The receiver still stores whatever string arrives (see stats.ts); this is the
 * display/validation side. A variant value is `<campaign-slug>-<n>`: 9 campaigns (one per List Type, "None" excluded) plus
 * "default" (the original flow) = 10 campaigns × variants 1–3 = 30 variants. Slugs are derived from LIST_TYPES so the two can't drift.
 */

export const VARIANT_NUMBERS = [1, 2, 3] as const;
export type VariantNumber = (typeof VARIANT_NUMBERS)[number];

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export type CampaignDef = { slug: string; label: string };

export const CAMPAIGNS: readonly CampaignDef[] = [
  { slug: "default", label: "Default" },
  ...LIST_TYPES.filter((t) => t !== "None").map((t) => ({ slug: slugify(t), label: t })),
];

export type VariantDef = { value: string; campaign: string; campaignLabel: string; number: VariantNumber; label: string };

/** All 30 variants, campaign order then number: "default-1" → "Default 1", "high-equity-3" → "High Equity 3". */
export const VARIANTS: readonly VariantDef[] = CAMPAIGNS.flatMap((c) =>
  VARIANT_NUMBERS.map((n) => ({ value: `${c.slug}-${n}`, campaign: c.slug, campaignLabel: c.label, number: n, label: `${c.label} ${n}` })),
);

const BY_VALUE = new Map(VARIANTS.map((v) => [v.value, v]));

export const isKnownVariant = (value: string): boolean => BY_VALUE.has(value);

/** Scorecard label; unknown or blank values fall back to the raw string ("" → "Unlabeled") so stray rows stay visible. */
export function variantLabel(value: string): string {
  return BY_VALUE.get(value)?.label ?? (value === "" ? "Unlabeled" : value);
}

export const parseVariant = (value: string): VariantDef | null => BY_VALUE.get(value) ?? null;
