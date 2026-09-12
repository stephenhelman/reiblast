// PREVIEW-ONLY SCAFFOLDING — exercises every launcher card state for visual
// verification. Gated behind TOOLS_PREVIEW_MOCK_MEMBER in lib/launcherCatalog.ts;
// never read by the real (Prisma) path and never affects resolver/meter/wallet
// behavior. A realistic launch member (zero subscriptions) would only ever show
// accessible (Score/Scrub) + coming-soon (everything else) — this fixture forces
// the locked and on-credits/out-of-credits states too, so every card design can
// be checked without hand-inserting subscription/ledger rows.
//
// State assignment (see each tool below):
//   score -> accessible / meter        (allowance remaining)
//   scrub -> accessible / unlimited    (null allowance, always allowance-covered)
//   pack  -> locked                    (forced active + not entitled)
//   ask   -> accessible / credits      (allowance spent, wallet has balance)
//   acq   -> accessible / out-of-credits (allowance spent, wallet empty)
//   dispo -> coming-soon               (active: false, real launch state)
//
// hasHigherTier matches the real seed (prisma/seed-catalog.ts): only Score has
// plus/pro rungs above base, so acq's "Keep going" gate is the one that shows
// the credits-only fallback (bots has no higher tier to offer). To see the
// upgrade CTA in ChoiceModal, temporarily flip acq's hasHigherTier to true —
// or, better, verify it via the store's ?from=score&intent=upgrade URL.

import type { LauncherMember, LauncherTool } from "@/types/launcher";

export const mockLauncherMember: LauncherMember = {
  id: "preview-member",
  name: "Preview Member",
  email: "preview@example.com",
  // Header balance readout only. In the real single-shared-wallet system this
  // number would have to agree with every card's accessibleState (you can't be
  // simultaneously "on credits" and "out of credits"), but each mock tool below
  // hardcodes its own accessibleState directly rather than deriving it from
  // this figure — that's what lets one fixture show every state at once.
  walletBalance: 42,
};

export const mockLauncherTools: LauncherTool[] = [
  {
    id: "preview-score",
    slug: "score",
    brandSlug: "rei-score",
    name: "REIscore",
    tagline: "Placeholder tagline: instant deal scoring.",
    unit: "analyses",
    href: "/rei-score",
    active: true,
    cardStatus: "accessible",
    accessibleState: "meter",
    allowance: 10,
    used: 4,
    remaining: 6,
    creditCost: 5,
    unitsPerDebit: 1,
    featureSlug: "score",
    hasHigherTier: true,
  },
  {
    id: "preview-scrub",
    slug: "scrub",
    brandSlug: "rei-scrub",
    name: "REIscrub",
    tagline: "Placeholder tagline: clean lead lists.",
    unit: "lookups",
    href: "/rei-scrub",
    active: true,
    cardStatus: "accessible",
    accessibleState: "unlimited",
    allowance: null,
    used: 0,
    remaining: null,
    creditCost: 0,
    unitsPerDebit: 1,
    featureSlug: "scrub",
    hasHigherTier: false,
  },
  {
    // Forced active-but-unowned so the locked card renders — real launch has
    // pack.active = false (coming-soon), not locked. Preview-only override.
    id: "preview-pack",
    slug: "pack",
    brandSlug: "rei-pack",
    name: "REIpack",
    tagline: "Placeholder tagline: buyer list packaging.",
    unit: "packets",
    href: "/rei-pack",
    active: true,
    cardStatus: "locked",
    allowance: null,
    used: 0,
    remaining: null,
    creditCost: 1,
    unitsPerDebit: 1,
    featureSlug: "pack",
    hasHigherTier: false,
  },
  {
    // Forced active + entitled + allowance spent, wallet has balance -> on-credits.
    id: "preview-ask",
    slug: "ask",
    brandSlug: "rei-ask",
    name: "REIask",
    tagline: "Placeholder tagline: AI deal Q&A.",
    unit: "queries",
    href: "/rei-ask",
    active: true,
    cardStatus: "accessible",
    accessibleState: "credits",
    allowance: 500,
    used: 500,
    remaining: 0,
    creditCost: 1,
    unitsPerDebit: 5,
    featureSlug: "ask",
    hasHigherTier: false,
  },
  {
    // Forced active + entitled + allowance spent, wallet empty -> out-of-credits gate.
    id: "preview-acq",
    slug: "acq",
    brandSlug: "rei-acq",
    name: "REIacq",
    tagline: "Placeholder tagline: acquisitions pipeline.",
    unit: "handoffs",
    href: "/rei-acq",
    active: true,
    cardStatus: "accessible",
    accessibleState: "out-of-credits",
    allowance: 60,
    used: 60,
    remaining: 0,
    creditCost: 10,
    unitsPerDebit: 1,
    featureSlug: "bots",
    hasHigherTier: false,
  },
  {
    // Real launch state — dispo stays inactive alongside acq.
    id: "preview-dispo",
    slug: "dispo",
    brandSlug: "rei-dispo",
    name: "REIdispo",
    tagline: "Placeholder tagline: dispo automation.",
    unit: "handoffs",
    href: "/rei-dispo",
    active: false,
    cardStatus: "coming-soon",
    allowance: null,
    used: 0,
    remaining: null,
    creditCost: 10,
    unitsPerDebit: 1,
    featureSlug: "bots",
    hasHigherTier: false,
  },
];
