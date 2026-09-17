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
import bcrypt from "bcryptjs";

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

// Dev-only credential for the admin-portal login (app/admin/login). The seeded
// admin has no a2pPhone/ghlContactId, so it can never resolve through the
// member OTP flow (resolveActiveMember) — this password is the only way in.
const ADMIN_DEV_PASSWORD = "admin-dev-password";

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
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 45;

/** A createdAt in the last ~45 days, weighted toward recent (a curve, not a spike). */
function curvedDate(): Date {
  // square the uniform → bias toward 0 (recent). 0 = now, 1 = 45 days ago.
  const r = rand() * rand();
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
// ---------------------------------------------------------------------------

const MODEL_RATES: Record<string, { in: number; out: number }> = {
  // cents per 1,000,000 tokens (input / output)
  "claude-haiku": { in: 100, out: 500 },
  "claude-sonnet": { in: 200, out: 1000 },
};
// Flat per-call cost for per-call record vendors (cents). Rentcast is intentionally
// absent — its cost is a subscription (VendorPlan), never a per-call number.
const VENDOR_FLAT: Record<string, number> = {
  melissa: 4,
};

/** Anthropic per-call cost in cents from tokens × per-model rate. */
function anthropicCostCents(model: string, inTok: number, outTok: number): number {
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
    prisma.apiCall.deleteMany({ where: { toolUse: { userId: { in: userIds } } } }),
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
};

const PERSONAS: Persona[] = [
  // --- Onboarding-stage coverage (little/no tool usage — pre-provisioning) ---
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
  {
    key: "inactive",
    name: "Inactive Ian",
    status: "inactive",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 12,
    subStatus: "canceled",
    runs: 6,
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
    runs: 9,
  },

  // --- Active members (the ones that generate the dashboard's real data) ---
  {
    key: "core",
    name: "Core-Only Casey",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [], // core-included Score only, base tier
    walletBalance: 40,
    subStatus: "active",
    runs: 22,
  },
  {
    key: "scoreplus",
    name: "Score-Plus Sofia",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: 85,
    subStatus: "active",
    runs: 34,
  },
  {
    key: "scorepro",
    name: "Score-Pro Pablo",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "pro"]],
    walletBalance: 210,
    subStatus: "active",
    runs: 41,
  },
  {
    key: "bundlepro",
    name: "Bundle-Pro Bianca",
    status: "active",
    role: "user",
    provisioned: true,
    // Bundle-Pro-qualifying set: score/pro + ask/plus + close(bots)/base
    subs: [
      ["score", "pro"],
      ["ask", "plus"],
      ["bots", "base"],
    ],
    walletBalance: 320,
    subStatus: "active",
    runs: 48,
  },
  {
    key: "pastdue",
    name: "Past-Due Petra",
    status: "active",
    role: "user",
    provisioned: true,
    subs: [["score", "plus"]],
    walletBalance: -8, // negative from a race/overage, not yet topped up
    subStatus: "past_due",
    runs: 18,
  },

  // --- Admin (own usage, isAdmin runs — the exclude-admin filter must move totals) ---
  {
    key: "admin",
    name: "Admin Adrian",
    status: "active",
    role: "admin",
    provisioned: true,
    subs: [["score", "pro"]],
    walletBalance: 500,
    subStatus: "active",
    runs: 30, // these runs are isAdmin:true
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
};

/**
 * Create ONE fully-correlated Score run: ToolUse + its ApiCalls + (if metered) its
 * LedgerEntry, all sharing toolUseId. This is the heart of the seed — the correlation
 * is the value.
 *
 * outcome: 'success' | 'fail' | 'partial'
 * comp:    'fresh' | 'cache'  (fresh = 3 vendor calls, cache = 1 sonnet call)
 */
async function createScoreRun(
  cat: Catalog,
  user: UserCtx,
  outcome: "success" | "fail" | "partial",
  comp: "fresh" | "cache",
  when: Date,
) {
  const scoreFeature = cat.featureBy("score");
  const scoreTool = cat.toolBy("score");
  const kind = pick(["SFR", "Land"]);

  // 1) The ToolUse (the run/anchor).
  const toolUse = await prisma.toolUse.create({
    data: {
      createdAt: when,
      locationId: user.locationId,
      userId: user.id,
      isAdmin: user.isAdmin,
      featureSlug: "score",
      kind,
      outcome: outcome as any, // ToolOutcome
      compSource: comp,
      propertyDataSource: comp,
    },
  });

  // 2) The ApiCall children — fresh = melissa + rentcast + sonnet, cache = sonnet only.
  //    A 'fail' still writes real ApiCalls (money was spent) — that's the point.
  //    costCents is frozen PER CALL: real for melissa/anthropic, NULL for rentcast
  //    (subscription — cost is period bill / period count, derived read-side).
  const apiCalls: Prisma.ApiCallCreateManyInput[] = [];

  if (comp === "fresh") {
    apiCalls.push({
      locationId: user.locationId,
      resource: "melissa",
      endpoint: "/property/detail",
      statusCode: 200,
      resultCount: 1,
      durationMs: randInt(280, 900),
      createdAt: when,
      toolUseId: toolUse.id,
      tool: "score",
      featureSlug: "score",
      isAdmin: user.isAdmin,
      costCents: VENDOR_FLAT.melissa, // 4¢ flat — true per-call cost
    });

    apiCalls.push({
      locationId: user.locationId,
      resource: "rentcast",
      endpoint: "/avm/value",
      statusCode: 200,
      resultCount: randInt(5, 30),
      durationMs: randInt(200, 700),
      createdAt: when,
      toolUseId: toolUse.id,
      tool: "score",
      featureSlug: "score",
      isAdmin: user.isAdmin,
      costCents: null, // subscription vendor — real cost derived read-side from VendorPlan
    });
  }

  // Sonnet call (always present, fresh or cache). On a 'fail', the model call errored
  // AFTER we paid for input tokens — realistic partial spend, still real cost.
  const model = "claude-sonnet";
  const inTok = randInt(4000, 14000);
  const outTok = outcome === "fail" ? randInt(0, 200) : randInt(600, 2400);
  apiCalls.push({
    locationId: user.locationId,
    resource: "anthropic",
    endpoint: "/v1/messages",
    statusCode: outcome === "fail" ? 500 : 200,
    resultCount: outcome === "fail" ? 0 : 1,
    durationMs: randInt(1800, 6000),
    createdAt: when,
    toolUseId: toolUse.id,
    tool: "score",
    featureSlug: "score",
    model,
    inputTokens: inTok,
    outputTokens: outTok,
    isAdmin: user.isAdmin,
    costCents: anthropicCostCents(model, inTok, outTok), // tokens × Sonnet rate
  });

  await prisma.apiCall.createMany({ data: apiCalls });

  // 3) The LedgerEntry consumption row — CLIENT-EYES money only (credits/allowance).
  //    NO vendor cost here (that's ApiCall.costCents, admin-eyes). Admin runs write
  //    NO ledger row at all (admin-tracked-not-metered).
  if (!user.isAdmin) {
    // Allowance-covered vs credit-debit: APPROXIMATED (the real meter isn't built yet).
    // plus/pro users cover more from allowance; the rest is a real 5-credit debit.
    const allowanceCovered = user.hasScorePlusOrPro ? rand() < 0.6 : rand() < 0.25;
    const isFail = outcome === "fail";
    const creditsDebited = isFail || allowanceCovered ? 0 : scoreFeature.creditCost;
    const ledgerOutcome = isFail ? "fail" : "success"; // ConsumptionOutcome (no 'partial')

    await prisma.ledgerEntry.create({
      data: {
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
        toolUseId: toolUse.id,
      },
    });
  }

  return { toolUse };
}

/** A lighter generator for non-score tools so the dashboard has feature variety. */
async function createSimpleRun(
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

  const toolUse = await prisma.toolUse.create({
    data: {
      createdAt: when,
      locationId: user.locationId,
      userId: user.id,
      isAdmin: user.isAdmin,
      featureSlug,
      kind: featureSlug === "bots" ? pick(["acq", "dispo"]) : "default",
      outcome: outcome as any,
      ...behavioral,
    },
  });

  // One representative vendor ApiCall (Anthropic for ask/bots/pack; none billable for scrub).
  // ask/pack run on Haiku; bots escalates Haiku->Sonnet. costCents frozen per call.
  if (featureSlug !== "scrub") {
    const model = featureSlug === "bots" && behavioral.escalated ? "claude-sonnet" : "claude-haiku";
    const inTok = randInt(1000, 8000);
    const outTok = outcome === "fail" ? randInt(0, 150) : randInt(200, 1500);
    await prisma.apiCall.create({
      data: {
        locationId: user.locationId,
        resource: "anthropic",
        endpoint: "/v1/messages",
        statusCode: outcome === "fail" ? 500 : 200,
        resultCount: outcome === "fail" ? 0 : 1,
        durationMs: randInt(500, 4000),
        createdAt: when,
        toolUseId: toolUse.id,
        tool: featureSlug,
        featureSlug,
        model,
        inputTokens: inTok,
        outputTokens: outTok,
        isAdmin: user.isAdmin,
        costCents: anthropicCostCents(model, inTok, outTok), // tokens × model rate
      },
    });
  }

  // Metered features write a CLIENT-EYES ledger row for members; scrub is free (metering none).
  // No vendor cost on the ledger — that lives on ApiCall.costCents (admin-eyes).
  const metered = feature.meteringShape !== "none";
  if (!user.isAdmin && metered) {
    const isFail = outcome === "fail";
    const allowanceCovered = rand() < 0.5;
    const creditsDebited = isFail || allowanceCovered ? 0 : feature.creditCost;
    await prisma.ledgerEntry.create({
      data: {
        createdAt: when,
        userId: user.id,
        kind: "consumption",
        creditDelta: -creditsDebited,
        toolId: tool?.id ?? null,
        featureId: feature.id,
        unitCount: featureSlug === "scrub" ? (behavioral.recordCount as number) : 1,
        creditsDebited,
        allowanceCovered: isFail ? false : allowanceCovered,
        outcome: (isFail ? "fail" : "success") as any,
        toolUseId: toolUse.id,
      },
    });
  }

  return { toolUse };
}

// ---------------------------------------------------------------------------
// 7. Build one user with wallet, subscriptions, funding, and runs
// ---------------------------------------------------------------------------

async function buildUser(cat: Catalog, p: Persona) {
  const createdAt = new Date(NOW - randInt(WINDOW_DAYS, WINDOW_DAYS + 30) * DAY);
  const locationId = p.provisioned ? `loc_seed_${p.key}` : null;

  const user = await prisma.user.create({
    data: {
      email: seedEmail(p.key),
      name: p.name,
      status: p.status,
      role: p.role as any,
      passwordHash: p.role === "admin" ? await bcrypt.hash(ADMIN_DEV_PASSWORD, 10) : null,
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
      data: { userId: user.id, balance: p.walletBalance, createdAt, updatedAt: createdAt },
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
    hasScorePlusOrPro: p.subs.some(([f, l]) => f === "score" && (l === "plus" || l === "pro")),
  };

  let scoreRuns = 0;
  let otherRuns = 0;
  for (let i = 0; i < p.runs; i++) {
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
      await createScoreRun(cat, ctx, outcome, comp, when);
      scoreRuns++;
    } else {
      // pick a feature the user has access to (bundle users have ask/bots).
      const available: Array<"ask" | "scrub" | "bots" | "pack"> = ["scrub"];
      if (p.subs.some(([f]) => f === "ask")) available.push("ask");
      if (p.subs.some(([f]) => f === "bots")) available.push("bots");
      await createSimpleRun(cat, ctx, pick(available), when);
      otherRuns++;
    }
  }

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
  const effectiveFrom = new Date(NOW - 60 * DAY);

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
      // Anthropic Sonnet — per-million-token integers ($2 / $10 per M).
      {
        resource: "anthropic",
        model: "sonnet",
        flatCents: null,
        perMillionInputTokens: 200,
        perMillionOutputTokens: 1000,
        effectiveFrom,
      },
      // Anthropic Haiku — per-million-token integers ($1 / $5 per M). Ask runs on Haiku;
      // bots escalates into Sonnet — both models must be priced or those tools have no basis.
      {
        resource: "anthropic",
        model: "haiku",
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
  console.log(`\nSeeding DEV data → ${SEED_URL!.replace(/:[^:@]+@/, ":****@")}\n`);

  const cat = await loadCatalog();
  console.log(`  catalog: ${cat.features.length} features, ${cat.tools.length} tools\n`);

  console.log("Seeding vendor cost tables…");
  await seedVendorTables();

  console.log("Wiping prior seed data…");
  await wipeSeedData();

  console.log("\nBuilding seed users + correlated runs…");
  for (const p of PERSONAS) {
    await buildUser(cat, p);
  }

  // Summary counts so a re-run is verifiable.
  const [users, subs, wallets, toolUses, apiCalls, ledger, adminRuns] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } }),
    prisma.subscription.count({ where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } } }),
    prisma.wallet.count({ where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } } }),
    prisma.toolUse.count({ where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } } }),
    prisma.apiCall.count({ where: { toolUse: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } } } }),
    prisma.ledgerEntry.count({ where: { user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } } }),
    prisma.toolUse.count({ where: { isAdmin: true, user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } } } }),
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
  console.log(`\n  admin login (app/admin/login): ${seedEmail("admin")} / ${ADMIN_DEV_PASSWORD}\n`);
}

main()
  .catch((e) => {
    console.error("\nSEED FAILED:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
