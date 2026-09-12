// FLAGGED DEFERRAL — selling copy (tagline/hook/compareCopy) and a couple of
// pure-presentation flags (pack "best value", bundle "best value") have no
// home in the engine schema (Tool/Feature/Bundle/CreditPack own price,
// allowance, and activation — not marketing copy). This file is the static
// stand-in, keyed by DB slug, until an admin surface earns these a real
// column (e.g. Tool.tagline/hook/compareCopy). Do NOT add that column now —
// this is scope for a later chat, not this wiring pass.
//
// Numbers (price, allowance, coverage) NEVER live here — those come from the
// DB via lib/storeCatalog.ts. This file is copy + display-only flags ONLY.

export interface ToolCopy {
  tagline: string;
  hook: string;
  compareCopy: string[];
}

export const STORE_TOOL_COPY: Record<string, ToolCopy> = {
  score: {
    tagline: "Placeholder tagline: instant deal scoring.",
    hook: "Placeholder hook: know if it's a deal in seconds.",
    compareCopy: ["Placeholder: ARV + comps", "Placeholder: offer ranges", "Placeholder: MAO calc"],
  },
  scrub: {
    tagline: "Placeholder tagline: clean lead lists.",
    hook: "Placeholder hook: dedupe and scrub before you dial.",
    compareCopy: ["Placeholder: DNC scrub", "Placeholder: dedupe"],
  },
  pack: {
    tagline: "Placeholder tagline: buyer list packaging.",
    hook: "Placeholder hook: package deals for your buyer list fast.",
    compareCopy: ["Placeholder: flyer generation", "Placeholder: buyer matching"],
  },
  ask: {
    tagline: "Placeholder tagline: AI deal Q&A.",
    hook: "Placeholder hook: ask anything about your pipeline.",
    compareCopy: ["Placeholder: natural-language queries", "Placeholder: deal summaries"],
  },
  acq: {
    tagline: "Placeholder tagline: acquisitions pipeline.",
    hook: "Placeholder hook: manage acquisitions end-to-end.",
    compareCopy: ["Placeholder: pipeline stages", "Placeholder: offer tracking"],
  },
  dispo: {
    tagline: "Placeholder tagline: dispo automation.",
    hook: "Placeholder hook: move contracts faster.",
    compareCopy: ["Placeholder: buyer blasts", "Placeholder: contract tracking"],
  },
};

export const STORE_BUNDLE_COPY: Record<string, { tagline: string; bestValue?: boolean }> = {
  "bundle-plus": { tagline: "Placeholder tagline: for active dispo." },
  "bundle-pro": { tagline: "Placeholder tagline: full pipeline coverage.", bestValue: true },
};

export const STORE_PACK_BEST_VALUE_SLUG = "pack-600";

export const STORE_CORE_TAGLINE = "Placeholder tagline: your baseline REIblast membership access.";

/**
 * The upgrade->credits fallback message (see lib/storeLink.ts#resolveArrival's
 * upgradeMaxedToolSlug) — affirming "you're at the ceiling," not an error.
 * This IS the "current ceiling reached" state: when a later tier-headroom
 * feature raises a tool's ceiling, hasHigherTier flips true for it and
 * resolveArrival routes to the upgrade path instead, so this message simply
 * stops firing for that tool — no change needed here when that happens.
 */
export function upgradeMaxedMessage(toolName: string): string {
  return `You're on ${toolName}'s top tier — buy credits to keep going.`;
}

// Op-direct services (REIsite/REIkit) are explicitly OUT of the engine tables
// (sprint doc §0) — sales, not entitlements. Config-only, no DB read, ever.
export interface AddonServiceSeed {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  hook: string;
  compareCopy: string[];
  priceCents: number;
  toolSlug: "rei-site" | "rei-kit";
}

export const STORE_ADDON_SERVICES: AddonServiceSeed[] = [
  {
    id: "op-direct-site",
    slug: "site",
    name: "REI/site",
    tagline: "Placeholder tagline: a compliant site built to book you deals.",
    hook: "Placeholder hook: a conversion-built website wired straight into your CRM, done for you start to finish.",
    compareCopy: ["Placeholder: full build + SEO", "Placeholder: routes leads into your CRM"],
    priceCents: 50000,
    toolSlug: "rei-site",
  },
  {
    id: "op-direct-kit",
    slug: "kit",
    name: "REI/kit",
    tagline: "Placeholder tagline: look legit — logo and brand kit, done for you.",
    hook: "Placeholder hook: a full logo and brand kit so you look established from day one.",
    compareCopy: ["Placeholder: logo + brand marks", "Placeholder: ready for site, packets, signage"],
    priceCents: 25000, // TBD — placeholder, unset in the product spec.
    toolSlug: "rei-kit",
  },
];
