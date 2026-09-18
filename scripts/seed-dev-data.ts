/**
 * seed-dev-data.ts — Universal DEV data seed for the REItools admin dashboard.
 *
 * Generates realistic, correlated data to visualize and test the admin portal:
 *   - Users across every onboarding stage (+ one admin).
 *   - Wallets + tool_sub subscriptions (statuses spread; a Bundle-Pro-qualifying set).
 *   - Correlated RUNS: each ToolUse writes its ApiCall children and (if metered) its
 *     LedgerEntry, all sharing toolUseId. Success / fail / partial. Admin vs member.
 *     Fresh-vs-cache on Score (3 ApiCalls vs 1) with realistic tokens so cost varies.
 *   - createdAt spread across ~45 days as a curve, not a spike.
 *
 * SAFETY (read this): this script writes a LOT of data. It runs ONLY against the dev
 * branch and HARD-REFUSES prod. It reads SEED_DATABASE_URL (never DATABASE_URL), asserts
 * the host is the dev branch, and refuses if it sees the prod host. All rows it creates are
 * SEED-MARKED (users via a recognizable email domain); re-running deletes prior seed-marked
 * data (FK-safe order) and rebuilds deterministically. It never touches non-seed rows.
 *
 * Run:  SEED_DATABASE_URL="postgresql://...dev..." npx tsx prisma/seed-dev-data.ts
 *
 * Assumes the catalog (Feature/Tier/Bundle/Tool) is already seeded by seed-catalog.ts —
 * it looks catalog rows up by slug and errors with a clear message if they're missing.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Bulk-insert accumulators. At 6-8k runs, per-row awaited create() calls would be
// thousands of Neon round-trips (minutes). Instead the run helpers push rows here with
// client-generated ids (randomUUID — no extra dependency), the correlation wired via
// those ids, and flushRuns() bulk-inserts each table with createMany. Correct correlation
// (ToolUse.id → ApiCall.toolUseId → LedgerEntry.toolUseId) is preserved because ids are
// generated up front. Flushed per-user to keep memory bounded.
// ---------------------------------------------------------------------------
const acc = {
  toolUses: [] as Prisma.ToolUseCreateManyInput[],
  apiCalls: [] as Prisma.ApiCallCreateManyInput[],
  ledgerEntries: [] as Prisma.LedgerEntryCreateManyInput[],
};

async function flushRuns() {
  if (acc.toolUses.length) {
    await prisma.toolUse.createMany({ data: acc.toolUses });
    acc.toolUses.length = 0;
  }
  if (acc.apiCalls.length) {
    await prisma.apiCall.createMany({ data: acc.apiCalls });
    acc.apiCalls.length = 0;
  }
  if (acc.ledgerEntries.length) {
    await prisma.ledgerEntry.createMany({ data: acc.ledgerEntries });
    acc.ledgerEntries.length = 0;
  }
}

// ---------------------------------------------------------------------------
// 0. SAFETY GUARDS — non-negotiable. This is the most dangerous file in the repo.
// ---------------------------------------------------------------------------

const SEED_URL = process.env.SEED_DATABASE_URL;

// Prod host fragment — the one database this script must NEVER touch.
const PROD_HOST_FRAGMENT = "ep-restless-silence";
// Dev host fragment — the only host this script is allowed to write to.
const DEV_HOST_FRAGMENT = "ep-bold-frost";

// Marker: every seed user's email is on this domain. All seed data hangs off these
// users, so this one marker scopes the entire delete-and-rebuild.
const SEED_EMAIL_DOMAIN = "seed.reitools.dev";
const seedEmail = (persona: string) => `${persona}@${SEED_EMAIL_DOMAIN}`;

function assertSafeTarget(): string {
  if (!SEED_URL) {
    throw new Error(
      "SEED_DATABASE_URL is not set. This script refuses to run without it — it will " +
        "NOT fall back to DATABASE_URL (that is prod). Set SEED_DATABASE_URL to the dev branch.",
    );
  }
  if (SEED_URL.includes(PROD_HOST_FRAGMENT)) {
    throw new Error(
      `REFUSING TO RUN: SEED_DATABASE_URL points at the PROD host (${PROD_HOST_FRAGMENT}). ` +
        "This script only ever runs against the dev branch. Aborting before any write.",
    );
  }
  if (!SEED_URL.includes(DEV_HOST_FRAGMENT)) {
    throw new Error(
      `REFUSING TO RUN: SEED_DATABASE_URL host is not the expected dev branch ` +
        `(${DEV_HOST_FRAGMENT}). If the dev branch changed, update DEV_HOST_FRAGMENT in this ` +
        "file deliberately. Aborting rather than guessing.",
    );
  }
  return SEED_URL;
}

const prisma = new PrismaClient({ datasourceUrl: assertSafeTarget() });

// ---------------------------------------------------------------------------
// 1. Deterministic helpers (seeded PRNG so re-runs are identical)
// ---------------------------------------------------------------------------

let _seed = 1337;
function rand(): number {
  // mulberry32 — small deterministic PRNG
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 60;

/**
 * A createdAt over the last ~60 days, shaped as an UPWARD RAMP (a growing product):
 * recent days get proportionally more runs, with day-to-day variance and a couple of
 * believable dips — so trend charts (cost/margin/usage) show a real shape, not flat noise.
 * Returns a date; callers weight run COUNT toward recent by calling this per-run.
 */
function curvedDate(): Date {
  // Bias strongly toward recent: 1 - sqrt(rand) puts most mass near "now".
  // 0 = now, 1 = 60 days ago.
  let r = 1 - Math.sqrt(rand());
  // Two believable dips: knock a slice of days ~day-40 and ~day-18 down in density
  // by occasionally rerolling a sample that lands in them.
  const daysAgo = r * WINDOW_DAYS;
  const inDip =
    (daysAgo > 38 && daysAgo < 43) || (daysAgo > 16 && daysAgo < 20);
  if (inDip && rand() < 0.6) r = 1 - Math.sqrt(rand()); // reroll → fewer runs land in the dip
  return new Date(NOW - r * WINDOW_DAYS * DAY);
}

// ---------------------------------------------------------------------------
// 2. Vendor cost model — per-ApiCall cost, frozen on ApiCall.costCents.
//
//    AUDIENCE SPLIT (locked): ApiCall = ADMIN-EYES (company cost, margin).
//    LedgerEntry = CLIENT-EYES (credits/allowance/wallet) — carries NO cost.
//
//    costCents on ApiCall is the TRUE marginal cost for per-call vendors
//    (Melissa flat, Anthropic tokens×rate). For RENTCAST it is NULL on purpose:
//    Rentcast is a subscription (VendorPlan), so a call's real cost is not a
//    per-call fact — it's period bill / period call count, computed READ-SIDE.
//    A null Rentcast costCents is the deliberate signal "compute from the plan,
//    don't sum me." These numbers mirror the VendorRate/VendorPlan rows seeded
//    in §9 — the live app reads those tables; the seed mirrors them so seeded
//    costs match what the rate book would compute.
//
//    Anthropic rates are integer CENTS per 1,000,000 tokens (locked):
//      Sonnet 200 / 1000 (= $2 / $10 per M in|out)
//      Haiku  100 /  500 (= $1 /  $5 per M in|out)
//    Melissa flat 4¢/call ($40 / 1000). Rentcast: null per-call (see above).
//
//    CANONICAL MODEL KEYS (exact-match join ApiCall.model ↔ VendorRate.model):
//      "claude-sonnet-5"  — matches what prod's analyzer already writes (align up to it)
//      "claude-haiku-4-5" — Haiku 4.5; forward standard (no prod Haiku writes yet)
//    These same strings are used for ApiCall.model AND VendorRate.model (§9) so the cost
//    join is exact — no substring match. Report both keys so the analyzer chat aligns Haiku.
// ---------------------------------------------------------------------------

const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5";

const MODEL_RATES: Record<string, { in: number; out: number }> = {
  // cents per 1,000,000 tokens (input / output) — keyed on the canonical model strings
  [HAIKU]: { in: 100, out: 500 },
  [SONNET]: { in: 200, out: 1000 },
};
// Flat per-call cost for per-call record vendors (cents). Rentcast is intentionally
// absent — its cost is a subscription (VendorPlan), never a per-call number.
const VENDOR_FLAT: Record<string, number> = {
  melissa: 4,
};

/** Anthropic per-call cost in cents from tokens × per-model rate. */
function anthropicCostCents(
  model: string,
  inTok: number,
  outTok: number,
): number {
  const rate = MODEL_RATES[model];
  if (!rate) return 0;
  return Math.round((inTok * rate.in + outTok * rate.out) / 1_000_000);
}

// ---------------------------------------------------------------------------
// 3. Catalog lookup (assumes seed-catalog.ts already ran)
// ---------------------------------------------------------------------------

async function loadCatalog() {
  const features = await prisma.feature.findMany({ include: { tiers: true } });
  if (features.length === 0) {
    throw new Error(
      "No Feature rows found. Run the catalog seed first (npx tsx prisma/seed-catalog.ts " +
        "against SEED_DATABASE_URL), then re-run this script.",
    );
  }
  const tools = await prisma.tool.findMany();

  const tierBy = (featureSlug: string, level: "base" | "plus" | "pro") => {
    const f = features.find((x) => x.slug === featureSlug);
    const t = f?.tiers.find((x) => x.level === level);
    if (!t) {
      throw new Error(
        `Catalog missing tier ${featureSlug}/${level}. Re-seed the catalog; the dev-data ` +
          "seed depends on it.",
      );
    }
    return t;
  };
  const featureBy = (slug: string) => {
    const f = features.find((x) => x.slug === slug);
    if (!f) throw new Error(`Catalog missing feature ${slug}.`);
    return f;
  };
  const toolBy = (slug: string) => tools.find((x) => x.slug === slug) ?? null;

  return { features, tools, tierBy, featureBy, toolBy };
}

type Catalog = Awaited<ReturnType<typeof loadCatalog>>;

// ---------------------------------------------------------------------------
// 4. Wipe prior seed data (FK-safe order), scoped to seed-marked users only
// ---------------------------------------------------------------------------

async function wipeSeedData() {
  const seedUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const userIds = seedUsers.map((u) => u.id);
  if (userIds.length === 0) return;

  // Children first, respecting FK (all onDelete: Restrict, so order matters).
  // CreditHold -> (settledLedgerEntry ref is a plain String, no FK) but references ToolUse.
  // LedgerEntry -> references ToolUse, User, Tool, Feature, CreditPack.
  // ApiCall -> references ToolUse.
  // ToolUse -> references User.
  // Subscription -> references User, Tier, Feature.
  // Wallet -> references User.
  await prisma.$transaction([
    prisma.creditHold.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.ledgerEntry.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.apiCall.deleteMany({
      where: { toolUse: { userId: { in: userIds } } },
    }),
    prisma.toolUse.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.subscription.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.wallet.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  console.log(`  wiped prior seed data for ${userIds.length} seed users`);
}

// ---------------------------------------------------------------------------
// 5. User personas — every onboarding stage, plus an admin
// ---------------------------------------------------------------------------

type Persona = {
  key: string;
  name: string;
  status: string; // User.status lifecycle
  role: "user" | "admin";
  provisioned: boolean; // has locationId + a2pPhone (past the /enter gate)
  // subscription plan for this user: list of [featureSlug, level]; [] = core-only
  subs: Array<[string, "base" | "plus" | "pro"]>;
  walletBalance: number; // credits
  subStatus: "active" | "past_due" | "canceled";
  runs: number; // how many correlated runs to generate for this user
  // allowance profile: shapes the allowance-covered vs credit-debit split so per-member
  // plan-fit stories exist. 'over' = near/over allowance cap (heavy user); 'under' = barely
  // uses it; 'normal' = typical. Drives the ~% allowance-covered in the meter approximation.
  profile?: "over" | "under" | "normal";
};

// ~18 users. Every User.status represented. Active users carry the volume — collectively
// their fresh Score runs (1 Rentcast call each) push the RECENT ~30-day period over the
// 1,000-call Rentcast quota so the overage gauge renders, while the earlier period stays under.
// Run counts are weighted so the 60-day curve ramps upward (see curvedDate).
const PERSONAS: Persona[] = [
  // --- Pre-provisioning: onboarding-stage coverage (no wallet/usage — just their stage) ---
  {
    key: "pending",
    name: "Pending Paula",
    status: "pending_onboarding",
    role: "user",
    provisioned: false,
    subs: [],
    walletBalance: 0,
    subStatus: "active",
    runs: 0,
  },
  {
    key: "pending2",
    name: "Pending Pete",
    status: "pending_onboarding",
    role: "user",
    provisioned: false,
    subs: [],
    walletBalance: 0,
    subStatus: "active",
    runs: 0,
  },
  {
    key: "formdone",
    name: "Form-Complete Frank",
    status: "onboarding_complete",
    role: "user",
    provisioned: false,
    subs: [],
    walletBalance: 0,
    subStatus: "active",
    runs: 0,
  },
  {
    key: "provisioning",
    name: "Provisioning Priya",
    status: "provisioning",
    role: "user",
    provisioned: false,
    subs: [],
    walletBalance: 0,
    subStatus: "active",
    runs: 0,
  },

  // --- Lapsed / problem states ---
  {
    key: "inactive",
    name: "Inactive Ian",
    status: "inactive",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 12,
    subStatus: "canceled",
    runs: 8,
    profile: "under",
  },
  {
    key: "suspended",
    name: "Suspended Sam",
    status: "suspended",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 0,
    subStatus: "past_due",
    runs: 11,
    profile: "normal",
  },
  {
    key: "pastdue",
    name: "Past-Due Petra",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: -8,
    subStatus: "past_due",
    runs: 22,
    profile: "normal",
  },

  // --- Active core-only members ---
  {
    key: "core",
    name: "Core-Only Casey",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [],
    walletBalance: 40,
    subStatus: "active",
    runs: 26,
    profile: "normal",
  },
  {
    key: "core2",
    name: "Core-Only Cody",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [],
    walletBalance: 8,
    subStatus: "active",
    runs: 34,
    profile: "over",
  }, // heavy on base → hits cap, buys credits

  // --- Active Score Plus ---
  {
    key: "scoreplus",
    name: "Score-Plus Sofia",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 85,
    subStatus: "active",
    runs: 44,
    profile: "normal",
  },
  {
    key: "scoreplus2",
    name: "Score-Plus Sean",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 4,
    subStatus: "active",
    runs: 2,
    profile: "under",
  }, // pays plus, barely uses, near-zero credits → downsell candidate
  {
    key: "scoreplus3",
    name: "Score-Plus Selena",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 30,
    subStatus: "active",
    runs: 70,
    profile: "over",
  }, // over plus allowance → genuine upgrade candidate (score plus→pro saves money)

  // --- Active Score Pro ---
  {
    key: "scorepro",
    name: "Score-Pro Pablo",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "pro"]],
    walletBalance: 210,
    subStatus: "active",
    runs: 62,
    profile: "normal",
  },
  {
    key: "scorepro2",
    name: "Score-Pro Priscilla",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "pro"]],
    walletBalance: 4,
    subStatus: "active",
    runs: 3,
    profile: "under",
  }, // top-tier but barely uses it, near-zero credits → downsell candidate
  // (never upsell — already top tier — while still exercising the churn/downsell path)

  // --- Bundle-qualifying sets (derived-bundle logic) ---
  {
    key: "bundleplus",
    name: "Bundle-Plus Bree",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [
      ["score", "plus"],
      ["ask", "base"],
    ],
    walletBalance: 120,
    subStatus: "active",
    runs: 65,
    profile: "over",
  }, // over allowance on plus tiers → real upgrade candidate (score→pro, ask→plus both save money)
  {
    key: "bundlepro",
    name: "Bundle-Pro Bianca",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [
      ["score", "pro"],
      ["ask", "plus"],
      ["bots", "base"],
    ],
    walletBalance: 320,
    subStatus: "active",
    runs: 78,
    profile: "normal",
  },
  {
    key: "bundlepro2",
    name: "Bundle-Pro Boris",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [
      ["score", "pro"],
      ["ask", "plus"],
      ["bots", "base"],
    ],
    walletBalance: 44,
    subStatus: "active",
    runs: 64,
    profile: "normal",
  }, // already top tier on score+ask → never upsell; healthy usage

  // --- Admin (isAdmin runs — NO ledger rows; the exclude-admin filter must move totals) ---
  {
    key: "admin",
    name: "Admin Adrian",
    status: "active",
    role: "admin",
    provisioned: true,
    subs: [["score", "pro"]],
    walletBalance: 500,
    subStatus: "active",
    runs: 40,
    profile: "normal",
  },
];

// ---------------------------------------------------------------------------
// 6. Run generators — the correlated ToolUse -> ApiCall[] -> LedgerEntry unit
// ---------------------------------------------------------------------------

type UserCtx = {
  id: string;
  locationId: string;
  isAdmin: boolean;
  // which score level the user has (drives allowance-covered vs credit-debit)
  hasScorePlusOrPro: boolean;
  // allowance profile — shapes the allowance-covered share (over-utilizers exhaust allowance
  // and spill to credits; under-utilizers stay mostly within it). Approximation only.
  profile: "over" | "under" | "normal";
};

/**
 * Create ONE fully-correlated Score run: ToolUse + its ApiCalls + (if metered) its
 * LedgerEntry, all sharing toolUseId. This is the heart of the seed — the correlation
 * is the value.
 *
 * outcome: 'success' | 'fail' | 'partial'
 * comp:    'fresh' | 'cache'  (fresh = 3 vendor calls, cache = 1 sonnet call)
 */
function createScoreRun(
  cat: Catalog,
  user: UserCtx,
  outcome: "success" | "fail" | "partial",
  comp: "fresh" | "cache",
  when: Date,
) {
  const scoreFeature = cat.featureBy("score");
  const scoreTool = cat.toolBy("score");
  const kind = pick(["SFR", "Land"]);

  // 1) The ToolUse (the run/anchor) — client-generated id so children can reference it
  //    before any DB write (enables bulk createMany while preserving correlation).
  const toolUseId = randomUUID();
  acc.toolUses.push({
    id: toolUseId,
    createdAt: when,
    locationId: user.locationId,
    userId: user.id,
    isAdmin: user.isAdmin,
    featureSlug: "score",
    kind,
    outcome: outcome as any, // ToolOutcome
    compSource: comp,
    propertyDataSource: comp,
  });

  // 2) The ApiCall children — fresh = melissa + rentcast + sonnet, cache = sonnet only.
  //    A 'fail' still writes real ApiCalls (money was spent). costCents frozen PER CALL:
  //    real for melissa/anthropic, NULL for rentcast (subscription — derived read-side).
  if (comp === "fresh") {
    acc.apiCalls.push({
      locationId: user.locationId,
      resource: "melissa",
      endpoint: "/property/detail",
      statusCode: 200,
      resultCount: 1,
      durationMs: randInt(280, 900),
      createdAt: when,
      toolUseId,
      tool: "score",
      featureSlug: "score",
      isAdmin: user.isAdmin,
      costCents: VENDOR_FLAT.melissa, // 4¢ flat — true per-call cost
    });

    acc.apiCalls.push({
      locationId: user.locationId,
      resource: "rentcast",
      endpoint: "/avm/value",
      statusCode: 200,
      resultCount: randInt(480, 520), // ~500 property records per call (stored elsewhere; not seeded)
      durationMs: randInt(200, 700),
      createdAt: when,
      toolUseId,
      tool: "score",
      featureSlug: "score",
      isAdmin: user.isAdmin,
      costCents: null, // subscription vendor — real cost derived read-side from VendorPlan
    });
  }

  // Sonnet call (always present). On 'fail' the model errored after input tokens were paid.
  const model = SONNET;
  const inTok = randInt(4000, 14000);
  const outTok = outcome === "fail" ? randInt(0, 200) : randInt(600, 2400);
  acc.apiCalls.push({
    locationId: user.locationId,
    resource: "anthropic",
    endpoint: "/v1/messages",
    statusCode: outcome === "fail" ? 500 : 200,
    resultCount: outcome === "fail" ? 0 : 1,
    durationMs: randInt(1800, 6000),
    createdAt: when,
    toolUseId,
    tool: "score",
    featureSlug: "score",
    model,
    inputTokens: inTok,
    outputTokens: outTok,
    isAdmin: user.isAdmin,
    costCents: anthropicCostCents(model, inTok, outTok), // tokens × Sonnet rate
  });

  // 3) LedgerEntry — CLIENT-EYES only (credits/allowance). No vendor cost. Admin runs: none.
  if (!user.isAdmin) {
    // Allowance-covered vs credit-debit: APPROXIMATED (real meter not built). A real paid
    // subscription is bought FOR the allowance, so the healthy default is mostly-covered
    // (~5-20% credit share) — only the deliberate 'over' outliers spill heavily into credits,
    // and 'under' outliers sit almost entirely inside their allowance.
    const paidBase = user.hasScorePlusOrPro ? 0.88 : 0.4; // free/base-tier has a small allowance
    const coveredProb =
      user.profile === "over"
        ? 0.25
        : user.profile === "under"
          ? 0.97
          : paidBase;
    const allowanceCovered = rand() < coveredProb;
    const isFail = outcome === "fail";
    const creditsDebited =
      isFail || allowanceCovered ? 0 : scoreFeature.creditCost;
    const ledgerOutcome = isFail ? "fail" : "success"; // ConsumptionOutcome (no 'partial')

    acc.ledgerEntries.push({
      createdAt: when,
      userId: user.id,
      kind: "consumption",
      creditDelta: -creditsDebited,
      toolId: scoreTool?.id ?? null,
      featureId: scoreFeature.id,
      unitCount: 1,
      creditsDebited,
      allowanceCovered: isFail ? false : allowanceCovered,
      outcome: ledgerOutcome as any,
      toolUseId,
    });
  }
}

/** A lighter generator for non-score tools so the dashboard has feature variety. */
function createSimpleRun(
  cat: Catalog,
  user: UserCtx,
  featureSlug: "ask" | "scrub" | "bots" | "pack",
  when: Date,
) {
  const feature = cat.featureBy(featureSlug);
  const tool = cat.toolBy(featureSlug);
  const outcome = pick(["success", "success", "success", "partial", "fail"]) as
    | "success"
    | "partial"
    | "fail";

  const behavioral: Record<string, unknown> = {};
  if (featureSlug === "ask") {
    behavioral.hitTokenMax = rand() < 0.15;
    behavioral.retrievalHit = rand() < 0.8;
  } else if (featureSlug === "bots") {
    behavioral.escalated = rand() < 0.3;
    behavioral.turnCount = randInt(2, 18);
  } else if (featureSlug === "scrub") {
    behavioral.recordCount = randInt(50, 5000);
  } else if (featureSlug === "pack") {
    behavioral.regenerated = rand() < 0.4;
  }

  const toolUseId = randomUUID();
  acc.toolUses.push({
    id: toolUseId,
    createdAt: when,
    locationId: user.locationId,
    userId: user.id,
    isAdmin: user.isAdmin,
    featureSlug,
    kind: featureSlug === "bots" ? pick(["acq", "dispo"]) : "default",
    outcome: outcome as any,
    ...behavioral,
  });

  // One representative vendor ApiCall (Anthropic for ask/bots/pack; none billable for scrub).
  // ask/pack run on Haiku; bots escalates Haiku->Sonnet. costCents frozen per call.
  if (featureSlug !== "scrub") {
    const model =
      featureSlug === "bots" && behavioral.escalated ? SONNET : HAIKU;
    const inTok = randInt(1000, 8000);
    const outTok = outcome === "fail" ? randInt(0, 150) : randInt(200, 1500);
    acc.apiCalls.push({
      locationId: user.locationId,
      resource: "anthropic",
      endpoint: "/v1/messages",
      statusCode: outcome === "fail" ? 500 : 200,
      resultCount: outcome === "fail" ? 0 : 1,
      durationMs: randInt(500, 4000),
      createdAt: when,
      toolUseId,
      tool: featureSlug,
      featureSlug,
      model,
      inputTokens: inTok,
      outputTokens: outTok,
      isAdmin: user.isAdmin,
      costCents: anthropicCostCents(model, inTok, outTok), // tokens × model rate
    });
  }

  // Metered features write a CLIENT-EYES ledger row for members; scrub is free (metering none).
  const metered = feature.meteringShape !== "none";
  if (!user.isAdmin && metered) {
    const isFail = outcome === "fail";
    // Same allowance-vs-credit shape as Score runs: healthy default mostly covered,
    // 'over'/'under' profiles are the deliberate outliers.
    const coveredProb =
      user.profile === "over" ? 0.25 : user.profile === "under" ? 0.97 : 0.88;
    const allowanceCovered = rand() < coveredProb;
    const creditsDebited = isFail || allowanceCovered ? 0 : feature.creditCost;
    acc.ledgerEntries.push({
      createdAt: when,
      userId: user.id,
      kind: "consumption",
      creditDelta: -creditsDebited,
      toolId: tool?.id ?? null,
      featureId: feature.id,
      unitCount:
        featureSlug === "scrub" ? (behavioral.recordCount as number) : 1,
      creditsDebited,
      allowanceCovered: isFail ? false : allowanceCovered,
      outcome: (isFail ? "fail" : "success") as any,
      toolUseId,
    });
  }
}

// ---------------------------------------------------------------------------
// 7. Build one user with wallet, subscriptions, funding, and runs
// ---------------------------------------------------------------------------

async function buildUser(cat: Catalog, p: Persona) {
  const createdAt = new Date(
    NOW - randInt(WINDOW_DAYS, WINDOW_DAYS + 30) * DAY,
  );
  const locationId = p.provisioned ? `loc_seed_${p.key}` : null;

  const user = await prisma.user.create({
    data: {
      email: seedEmail(p.key),
      name: p.name,
      status: p.status,
      role: p.role as any,
      onboardingComplete: p.status !== "pending_onboarding",
      a2pPhone: p.provisioned ? `+1915555${randInt(1000, 9999)}` : null,
      ghlLocationId: locationId,
      businessName: `${p.name} REI`,
      createdAt,
      updatedAt: createdAt,
    },
  });

  // Wallet (only for provisioned users — pre-provisioning users have no wallet yet).
  if (p.provisioned) {
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: p.walletBalance,
        createdAt,
        updatedAt: createdAt,
      },
    });

    // A funding row so the wallet balance has a ledger origin (positive credits in).
    if (p.walletBalance > 0) {
      await prisma.ledgerEntry.create({
        data: {
          createdAt,
          userId: user.id,
          kind: "funding",
          creditDelta: p.walletBalance + 100, // funded more than current (some was spent)
          reason: "pack_purchase",
          refId: `seed_pack_${p.key}`,
        },
      });
    }
  }

  // Subscriptions — always tool_subs (bundle membership is derived, never a bundle row).
  for (const [featureSlug, level] of p.subs) {
    const tier = cat.tierBy(featureSlug, level);
    const periodStart = new Date(NOW - randInt(1, 28) * DAY);
    const periodEnd = new Date(periodStart.getTime() + 30 * DAY);
    await prisma.subscription.create({
      data: {
        userId: user.id,
        tierId: tier.id,
        featureId: tier.featureId,
        status: p.subStatus as any,
        periodStart,
        periodEnd,
        stripeSubscriptionId: `sub_seed_${p.key}_${featureSlug}`,
        createdAt: periodStart,
        updatedAt: periodStart,
      },
    });
  }

  // Runs — the correlated data. Only provisioned users with runs > 0.
  const ctx: UserCtx = {
    id: user.id,
    locationId: locationId ?? `loc_seed_${p.key}`,
    isAdmin: p.role === "admin",
    hasScorePlusOrPro: p.subs.some(
      ([f, l]) => f === "score" && (l === "plus" || l === "pro"),
    ),
    profile: p.profile ?? "normal",
  };

  let scoreRuns = 0;
  let otherRuns = 0;
  // Volume multiplier: the persona run counts are relative weights; RUN_MULTIPLIER scales them
  // to the ~6-8k total needed for the recent ~30-day period to cross the 1,000-call Rentcast
  // quota (so the overage gauge renders). ~607 base runs × 12 ≈ 7,300 runs; ~70% score × ~60%
  // fresh ≈ 3,000 Rentcast calls total, curve-weighted so the recent period alone exceeds 1,000.
  const RUN_MULTIPLIER = 12;
  const totalRuns = p.runs * RUN_MULTIPLIER;
  for (let i = 0; i < totalRuns; i++) {
    const when = curvedDate();
    // ~70% score runs, 30% other tools (only if the user could plausibly use them).
    const doScore = rand() < 0.7 || p.subs.length === 0;
    if (doScore) {
      // outcome mix: mostly success, some partial, some fail (incl. paid-but-no-revenue).
      const outcome = pick([
        "success",
        "success",
        "success",
        "success",
        "partial",
        "fail",
      ]) as "success" | "partial" | "fail";
      // fresh vs cache: ~40% cache hits (the caching-saves-money story).
      const comp = rand() < 0.4 ? "cache" : "fresh";
      createScoreRun(cat, ctx, outcome, comp, when);
      scoreRuns++;
    } else {
      // pick a feature the user has access to (bundle users have ask/bots).
      const available: Array<"ask" | "scrub" | "bots" | "pack"> = ["scrub"];
      if (p.subs.some(([f]) => f === "ask")) available.push("ask");
      if (p.subs.some(([f]) => f === "bots")) available.push("bots");
      createSimpleRun(cat, ctx, pick(available), when);
      otherRuns++;
    }
  }

  // Bulk-insert this user's accumulated runs (ToolUse → ApiCall → LedgerEntry), correlation
  // preserved via the client-generated ids. Flushing per-user keeps memory bounded.
  await flushRuns();

  console.log(
    `  ${p.name.padEnd(22)} status=${p.status.padEnd(20)} role=${p.role.padEnd(6)} ` +
      `subs=${p.subs.length} runs=${scoreRuns}+${otherRuns}`,
  );
  return user;
}

// ---------------------------------------------------------------------------
// 9. Vendor cost tables — VendorRate (per-call rate book) + VendorPlan
//    (subscription vendors only). These are GLOBAL config, not per-user, so they
//    are NOT part of the seed-user wipe. Idempotent: cleared + reseeded each run
//    so they always reflect the locked numbers. Real values (locked 2026-09-17):
//      VendorRate: melissa 4¢ flat; anthropic sonnet 200/1000 per M; haiku 100/500 per M.
//                  NO rentcast row — Rentcast is a subscription, not a per-call rate.
//      VendorPlan: rentcast — $74/mo (7400¢), 1000 included calls, 6¢/overage, anchor day 1.
//    effectiveFrom is set ~60 days ago so it covers the whole ~45-day run window.
// ---------------------------------------------------------------------------

async function seedVendorTables() {
  // effectiveFrom well before the 60-day run window so every seeded call resolves a rate.
  const effectiveFrom = new Date(NOW - (WINDOW_DAYS + 30) * DAY);

  // Idempotent: wipe the vendor config we own, then reseed to the locked numbers.
  await prisma.vendorRate.deleteMany({});
  await prisma.vendorPlan.deleteMany({});

  await prisma.vendorRate.createMany({
    data: [
      // Melissa — flat per-call (record vendor, no model).
      {
        resource: "melissa",
        model: null,
        flatCents: 4,
        perMillionInputTokens: null,
        perMillionOutputTokens: null,
        effectiveFrom,
      },
      // Anthropic Sonnet — keyed on the CANONICAL model string (exact-match join with ApiCall.model).
      {
        resource: "anthropic",
        model: SONNET, // "claude-sonnet-5" — matches prod's analyzer writes
        flatCents: null,
        perMillionInputTokens: 200,
        perMillionOutputTokens: 1000,
        effectiveFrom,
      },
      // Anthropic Haiku — canonical key. Ask runs on Haiku; bots escalates into Sonnet —
      // both models must be priced or those tools have no cost basis.
      {
        resource: "anthropic",
        model: HAIKU, // "claude-haiku-4-5" — forward standard; analyzer aligns when Ask is live
        flatCents: null,
        perMillionInputTokens: 100,
        perMillionOutputTokens: 500,
        effectiveFrom,
      },
      // NO rentcast VendorRate row — Rentcast's cost is a subscription (VendorPlan),
      // never a per-call rate. Its ApiCall.costCents is null; cost is derived read-side.
    ],
  });

  await prisma.vendorPlan.create({
    data: {
      resource: "rentcast",
      baseMonthlyCents: 7400, // $74/mo
      includedQuota: 1000, // calls included per period
      overageCentsPerCall: 6, // $0.06 per call past quota
      periodAnchorDay: 1, // billing day of month (update if the real invoice differs)
      active: true,
    },
  });

  console.log("  vendor tables: 3 VendorRate rows, 1 VendorPlan (rentcast)\n");
}

// ---------------------------------------------------------------------------
// 8. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `\nSeeding DEV data → ${SEED_URL!.replace(/:[^:@]+@/, ":****@")}\n`,
  );

  const cat = await loadCatalog();
  console.log(
    `  catalog: ${cat.features.length} features, ${cat.tools.length} tools\n`,
  );

  console.log("Seeding vendor cost tables…");
  await seedVendorTables();

  console.log("Wiping prior seed data…");
  await wipeSeedData();

  console.log("\nBuilding seed users + correlated runs…");
  for (const p of PERSONAS) {
    await buildUser(cat, p);
  }

  // Summary counts so a re-run is verifiable.
  const [users, subs, wallets, toolUses, apiCalls, ledger, adminRuns] =
    await Promise.all([
      prisma.user.count({
        where: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } },
      }),
      prisma.subscription.count({
        where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } },
      }),
      prisma.wallet.count({
        where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } },
      }),
      prisma.toolUse.count({
        where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } },
      }),
      prisma.apiCall.count({
        where: {
          toolUse: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } },
        },
      }),
      prisma.ledgerEntry.count({
        where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } },
      }),
      prisma.toolUse.count({
        where: {
          isAdmin: true,
          user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } },
        },
      }),
    ]);

  const [vendorRates, vendorPlans] = await Promise.all([
    prisma.vendorRate.count(),
    prisma.vendorPlan.count(),
  ]);

  console.log("\nSeed complete:");
  console.log(`  users:        ${users}`);
  console.log(`  subscriptions:${subs}`);
  console.log(`  wallets:      ${wallets}`);
  console.log(`  toolUses:     ${toolUses}  (of which isAdmin: ${adminRuns})`);
  console.log(`  apiCalls:     ${apiCalls}`);
  console.log(`  ledgerEntries:${ledger}`);
  console.log(`  vendorRates:  ${vendorRates}   vendorPlans: ${vendorPlans}`);
  console.log(`\n  admin login: ${seedEmail("admin")}  (role=admin)\n`);
}

main()
  .catch((e) => {
    console.error("\nSEED FAILED:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
