// PLACEHOLDER-BUT-GROUNDED SEED DATA — prices/allowances/credit costs below are
// pulled from the product spec (credits ~$0.20 each) rather than invented, but
// are still placeholders pending real pricing sign-off. Taglines/hooks/compare
// copy remain pure placeholder strings. Do not ship any of this as-is.
//
// Read via lib/catalog.ts — do not import this file directly from components.

import { CORE_PRICE, PLATFORM_NAME } from "@/lib/constants";
import type { Bundle, Catalog, OpDirectService, Pack, SoloPlan, Tool } from "@/types/catalog";

const tools: Tool[] = [
  {
    type: "tool",
    slug: "rei-score",
    name: "REIscore",
    tagline: "Placeholder tagline: instant deal scoring.",
    hook: "Placeholder hook: know if it's a deal in seconds.",
    icon: "/brand/icons/rei-score.svg",
    wordmark: "/brand/wordmarks/rei-score.png",
    category: "Analysis",
    unit: "analysis",
    href: "/rei-score",
    consumesCredits: true,
    creditCost: { amount: 5 },
    compareCopy: ["Placeholder: ARV + comps", "Placeholder: offer ranges", "Placeholder: MAO calc"],
  },
  {
    type: "tool",
    slug: "rei-pack",
    name: "REIpack",
    tagline: "Placeholder tagline: buyer list packaging.",
    hook: "Placeholder hook: package deals for your buyer list fast.",
    icon: "/brand/icons/rei-pack.svg",
    wordmark: "/brand/wordmarks/rei-pack.png",
    category: "Dispo",
    unit: "packet",
    href: "/rei-pack",
    consumesCredits: true,
    creditCost: { amount: 1 },
    compareCopy: ["Placeholder: flyer generation", "Placeholder: buyer matching"],
  },
  {
    type: "tool",
    slug: "rei-ask",
    name: "REIask",
    tagline: "Placeholder tagline: AI deal Q&A.",
    hook: "Placeholder hook: ask anything about your pipeline.",
    icon: "/brand/icons/rei-ask.svg",
    wordmark: "/brand/wordmarks/rei-ask.png",
    category: "AI",
    unit: "query",
    href: "/rei-ask",
    consumesCredits: true,
    // 1 credit per 5 queries (0.2 credits/query) — represented as a fractional amount.
    creditCost: { amount: 0.2 },
    compareCopy: ["Placeholder: natural-language queries", "Placeholder: deal summaries"],
  },
  {
    type: "tool",
    slug: "rei-scrub",
    name: "REIscrub",
    tagline: "Placeholder tagline: clean lead lists.",
    hook: "Placeholder hook: dedupe and scrub before you dial.",
    icon: "/brand/icons/rei-scrub.svg",
    wordmark: "/brand/wordmarks/rei-scrub.png",
    category: "Leads",
    unit: "lookup",
    href: "/rei-scrub",
    consumesCredits: false,
    compareCopy: ["Placeholder: DNC scrub", "Placeholder: dedupe"],
  },
  {
    type: "tool",
    slug: "rei-dispo",
    name: "REIdispo",
    tagline: "Placeholder tagline: dispo automation.",
    hook: "Placeholder hook: move contracts faster.",
    icon: "/brand/icons/rei-dispo.svg",
    wordmark: "/brand/wordmarks/rei-dispo.png",
    category: "Dispo",
    unit: "handoff",
    href: "/rei-dispo",
    consumesCredits: true,
    creditCost: { amount: 10 },
    // REIacq + REIdispo are two Tool marks sharing ONE "bots" entitlement/subscription/pool.
    entitlementGroup: "bots",
    compareCopy: ["Placeholder: buyer blasts", "Placeholder: contract tracking"],
  },
  {
    type: "tool",
    slug: "rei-acq",
    name: "REIacq",
    tagline: "Placeholder tagline: acquisitions pipeline.",
    hook: "Placeholder hook: manage acquisitions end-to-end.",
    icon: "/brand/icons/rei-acq.svg",
    wordmark: "/brand/wordmarks/rei-acq.png",
    category: "Acquisitions",
    unit: "handoff",
    href: "/rei-acq",
    consumesCredits: true,
    creditCost: { amount: 10 },
    // REIacq + REIdispo are two Tool marks sharing ONE "bots" entitlement/subscription/pool.
    entitlementGroup: "bots",
    compareCopy: ["Placeholder: pipeline stages", "Placeholder: offer tracking"],
  },
  {
    type: "tool",
    slug: "rei-close",
    name: "REIclose",
    tagline: "Placeholder tagline: closing coordination.",
    hook: "Placeholder hook: get to close without the chaos.",
    icon: "/brand/icons/rei-close.svg",
    wordmark: "/brand/wordmarks/rei-close.png",
    category: "Closing",
    unit: "run",
    href: "/rei-close",
    consumesCredits: false,
    compareCopy: ["Placeholder: title coordination", "Placeholder: doc tracking"],
  },
  {
    type: "tool",
    slug: "rei-site",
    name: "REIsite",
    tagline: "Placeholder tagline: landing pages for deals.",
    hook: "Placeholder hook: spin up a deal site in minutes.",
    icon: "/brand/icons/rei-site.svg",
    wordmark: "/brand/wordmarks/rei-site.png",
    category: "Marketing",
    unit: "run",
    href: "/rei-site",
    consumesCredits: false,
    free: true,
    compareCopy: ["Placeholder: hosted pages", "Placeholder: lead capture form"],
  },
  {
    type: "tool",
    slug: "rei-kit",
    name: "REIkit",
    tagline: "Placeholder tagline: contract + doc templates.",
    hook: "Placeholder hook: every template you need, ready to send.",
    icon: "/brand/icons/rei-kit.svg",
    wordmark: "/brand/wordmarks/rei-kit.png",
    category: "Docs",
    unit: "run",
    href: "/rei-kit",
    consumesCredits: false,
    comingSoon: true,
    compareCopy: ["Placeholder: state-specific contracts", "Placeholder: e-sign ready"],
  },
];

// Universal shared-wallet packs — REItools-Architecture §5: 100/$18, 250/$40,
// 600/$90 (~$0.18-0.20/credit, better rate at scale). Not tied to any tool —
// packToUnits() translates a pack's credits into any metered tool's units.
const packs: Pack[] = [
  { type: "pack", id: "pack-100", name: "100 credits", credits: 100, price: 18 },
  { type: "pack", id: "pack-250", name: "250 credits", credits: 250, price: 40 },
  { type: "pack", id: "pack-600", name: "600 credits", credits: 600, price: 90, bestValue: true },
];

// Core is a NON-purchasable reference baseline (§5) — what every member already
// has via the base membership, not a store "bundle". Kept separate from
// `bundles` below; see catalog.coreBaseline / lib/catalog's getCoreBaseline().
// rei-scrub/rei-site stay listed in `covers` purely so resolveAllowance still
// treats them as unlimited/free when Core is the active bundle — they're not
// a marketed Core feature, just carried-forward baseline access.
const coreBaseline: Bundle = {
  type: "bundle",
  id: "bundle-core",
  slug: "core",
  name: "Core",
  tagline: "Placeholder tagline: your baseline REIblast membership access.",
  price: 0,
  covers: ["rei-score", "rei-scrub", "rei-site"],
  allowances: { "rei-score": 10 },
  compareCopy: ["Placeholder: included with your membership", "Placeholder: baseline REIscore analyses"],
};

// Two purchasable bundles only (§5), additive on top of the $57 membership.
// allowanceByLevel: score {core:10, plus:50, pro:175}; ask {solo:500} from
// Plus; pack {solo:150} from Plus; bots {solo:60 shared} from Pro only.
// rei-scrub/rei-site carried forward in `covers` for the same reason as Core
// (see above) — not a distinguishing Plus/Pro feature, just baseline access
// that shouldn't disappear when a member upgrades off Core.
//
// À-la-carte checks (must stay true — see solo prices below):
//   Plus $49 < score-plus($25) + ask($15) + pack($19) = $59
//   Pro  $149 < score-pro($69) + ask($15) + pack($19) + bots($79) = $182
const bundles: Bundle[] = [
  {
    type: "bundle",
    id: "bundle-plus",
    slug: "plus",
    name: "Plus",
    tagline: "Placeholder tagline: for active dispo.",
    price: 49,
    covers: ["rei-score", "rei-scrub", "rei-site", "rei-ask", "rei-pack"],
    allowances: { "rei-score": 50, "rei-ask": 500, "rei-pack": 150 },
    compareCopy: ["Placeholder: REIscore — 50/mo", "Placeholder: REIask — 500 queries/mo", "Placeholder: REIpack — 150/mo"],
  },
  {
    type: "bundle",
    id: "bundle-pro",
    slug: "pro",
    name: "Pro",
    tagline: "Placeholder tagline: full pipeline coverage.",
    price: 149,
    bestValue: true,
    covers: ["rei-score", "rei-scrub", "rei-site", "rei-ask", "rei-pack", "bots"],
    allowances: { "rei-score": 175, "rei-ask": 500, "rei-pack": 150, bots: 60 },
    compareCopy: [
      "Placeholder: REIscore — 175/mo",
      "Placeholder: REIask — 500 queries/mo",
      "Placeholder: REIpack — 150/mo",
      "Placeholder: REIacq + REIdispo bots — 60 shared handoffs/mo",
    ],
  },
];

// Solo subs (§5) — REIscore has two tiers (Plus-equivalent, Pro-equivalent);
// REIask, REIpack, and the shared "bots" pool each have one.
const soloPlans: SoloPlan[] = [
  { type: "solo-plan", id: "score-plus-solo", entitlementKey: "rei-score", name: "REIscore solo — Plus", price: 25, allowance: 50 },
  { type: "solo-plan", id: "score-pro-solo", entitlementKey: "rei-score", name: "REIscore solo — Pro", price: 69, allowance: 175 },
  { type: "solo-plan", id: "ask-sub", entitlementKey: "rei-ask", name: "REIask solo", price: 15, allowance: 500 },
  { type: "solo-plan", id: "pack-sub", entitlementKey: "rei-pack", name: "REIpack solo", price: 19, allowance: 150 },
  { type: "solo-plan", id: "bots-sub", entitlementKey: "bots", name: "REIacq + REIdispo bots", price: 79, allowance: 60 },
];

// Done-for-you, one-time builds distributed by OP Web Studio — separate from the
// metered/free rei-site & rei-kit Tool entries above (those are the in-app tools;
// these are the store's build-it-for-you services, matching the store mockup).
// §5: both are launchable:false, consumesCredits:false, bucket "op-direct", no
// metering/allowance — the OpDirectService type has no such fields because
// nothing (cardStatus, packToUnits, resolveAllowance) is ever called on one;
// `type: "op-direct"` already IS the bucket discriminator, and REIsite/REIkit
// never appear as launcher cards, so "not launchable/not metered" is simply
// true by construction rather than a flag to set.
const opDirectServices: OpDirectService[] = [
  {
    type: "op-direct",
    id: "op-direct-site",
    slug: "site",
    name: "REI/site",
    tagline: "Placeholder tagline: a compliant site built to book you deals.",
    hook: "Placeholder hook: a conversion-built website wired straight into your CRM, done for you start to finish.",
    price: 500,
    toolSlug: "rei-site",
    compareCopy: ["Placeholder: full build + SEO", "Placeholder: routes leads into your CRM"],
  },
  {
    type: "op-direct",
    id: "op-direct-kit",
    slug: "kit",
    name: "REI/kit",
    tagline: "Placeholder tagline: look legit — logo and brand kit, done for you.",
    hook: "Placeholder hook: a full logo and brand kit so you look established from day one.",
    price: 250, // TBD — placeholder, unset in the product spec.
    toolSlug: "rei-kit",
    compareCopy: ["Placeholder: logo + brand marks", "Placeholder: ready for site, packets, signage"],
  },
];

export const catalog: Catalog = {
  tools,
  packs,
  bundles,
  coreBaseline,
  soloPlans,
  opDirectServices,
  membership: { name: PLATFORM_NAME, price: CORE_PRICE },
};
