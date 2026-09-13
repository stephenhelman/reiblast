// The ONE dbSlug -> brand slug map, shared by every engine-backed accessor
// (launcher, store). brandAssets.ts stays keyed by the rei-* ToolSlug union;
// this is the single place that bridges bare DB Tool.slug values to it.
// Extracted out of lib/launcherCatalog.ts so the store accessor doesn't fork
// its own copy.

import type { ToolSlug } from "@/types/catalog";

const DB_SLUG_TO_BRAND_SLUG: Record<string, ToolSlug> = {
  score: "rei-score",
  scrub: "rei-scrub",
  pack: "rei-pack",
  ask: "rei-ask",
  acq: "rei-acq",
  dispo: "rei-dispo",
};

export function brandSlugFor(dbSlug: string): ToolSlug {
  const brandSlug = DB_SLUG_TO_BRAND_SLUG[dbSlug];
  if (!brandSlug)
    throw new Error(
      `brandSlugFor: no brand slug mapped for DB tool slug "${dbSlug}"`,
    );
  return brandSlug;
}
