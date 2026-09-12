// The store's data path — parallel to lib/launcherCatalog.ts, same engine
// tables and the same 2-axis rule, reshaped for the store's four tabs. The
// launcher's own files are untouched; this is a new, independent accessor.

import { cookies } from "next/headers";
import type { Feature, PrismaClient, Tier, Tool as PrismaTool } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveFeature } from "@/lib/engine/resolver";
import { isEntitled, getCurrentBundleSlug, hasHigherTier } from "@/lib/entitlement";
import { verifyToolsSession } from "@/lib/toolsSession";
import { TOOLS_SESSION_COOKIE, CORE_PRICE, PLATFORM_NAME } from "@/lib/constants";
import { brandSlugFor } from "@/lib/brandSlug";
import {
  STORE_TOOL_COPY,
  STORE_BUNDLE_COPY,
  STORE_PACK_BEST_VALUE_SLUG,
  STORE_CORE_TAGLINE,
  STORE_ADDON_SERVICES,
} from "@/config/storeCopy";
import { mockStoreData } from "@/config/store.mock";
import { deriveTierName, deriveBundleCoverage, type BundleWithCoverage } from "@/lib/catalogDerive";
import type { StoreData, StoreTier, StoreTool, StoreBundle, StoreCoreBaseline } from "@/types/store";

type ToolWithFeatureAndTiers = PrismaTool & { feature: Feature & { tiers: Tier[] } };

async function buildStoreTool(tool: ToolWithFeatureAndTiers, userId: string): Promise<StoreTool> {
  const copy = STORE_TOOL_COPY[tool.slug];
  if (!copy) throw new Error(`storeCatalog: no STORE_TOOL_COPY entry for DB tool slug "${tool.slug}"`);

  const status = !tool.active ? "coming-soon" : (await isEntitled(prisma, userId, tool.feature)) ? "in-plan" : "available";

  const tiers: StoreTier[] = tool.feature.tiers.map((tier) => ({
    id: tier.id,
    level: tier.level,
    name: deriveTierName(tool.name, tier),
    priceCents: tier.priceCents,
    allowance: tier.allowance,
  }));

  // The "upgrade" honesty check — only meaningful once the tool is live;
  // coming-soon tools have no current tier to move up from.
  let higherTier = false;
  if (tool.active) {
    const resolved = await resolveFeature(prisma, userId, tool.feature.slug);
    higherTier = await hasHigherTier(prisma, tool.feature.slug, resolved.level);
  }

  return {
    id: tool.id,
    slug: tool.slug,
    brandSlug: brandSlugFor(tool.slug),
    name: tool.name,
    tagline: copy.tagline,
    hook: copy.hook,
    compareCopy: copy.compareCopy,
    unit: tool.unit,
    active: tool.active,
    featureSlug: tool.feature.slug,
    creditCost: tool.feature.creditCost,
    unitsPerDebit: tool.feature.unitsPerDebit,
    meteringShape: tool.feature.meteringShape,
    status,
    tiers,
    hasHigherTier: higherTier,
  };
}

function buildStoreBundle(bundle: BundleWithCoverage): StoreBundle {
  const copy = STORE_BUNDLE_COPY[bundle.slug];
  if (!copy) throw new Error(`storeCatalog: no STORE_BUNDLE_COPY entry for bundle slug "${bundle.slug}"`);

  const { available, coverageLines, coversFeatureSlugs } = deriveBundleCoverage(bundle);

  return {
    id: bundle.id,
    slug: bundle.slug,
    name: bundle.name,
    level: bundle.level,
    priceCents: bundle.priceCents,
    tagline: copy.tagline,
    bestValue: copy.bestValue,
    available,
    coverageLines,
    coversFeatureSlugs,
  };
}

function buildCoreBaseline(
  coreFeatures: (Feature & { tiers: Tier[]; surfaces: PrismaTool[] })[],
): StoreCoreBaseline {
  const coverageLines = coreFeatures.flatMap((feature) => {
    const baseTier = feature.tiers[0];
    return feature.surfaces
      .filter((tool) => tool.active)
      .map((tool) => {
        const allowanceText = baseTier?.allowance == null ? "Unlimited" : `${baseTier.allowance}`;
        return `${tool.name} — ${allowanceText} ${tool.unit}/mo included`;
      });
  });

  return { name: "Core", tagline: STORE_CORE_TAGLINE, coverageLines };
}

async function resolveSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOOLS_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await verifyToolsSession(token);
  if (!session) return null;

  // Mirrors lib/launcherCatalog.ts / lib/catalog.ts — real session -> User
  // lookup isn't wired up for the tools portal yet.
  return null;
}

async function getRealStoreData(userId: string, client: PrismaClient): Promise<StoreData> {
  const [user, wallet, tools, packs, bundles, currentBundleSlug, coreFeatures] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: userId } }),
    client.wallet.findUnique({ where: { userId } }),
    client.tool.findMany({
      include: { feature: { include: { tiers: true } } },
      orderBy: { createdAt: "asc" },
    }),
    client.creditPack.findMany({ orderBy: { credits: "asc" } }),
    client.bundle.findMany({
      include: { tiers: { include: { tier: { include: { feature: { include: { surfaces: true } } } } } } },
      orderBy: { priceCents: "asc" },
    }),
    getCurrentBundleSlug(client, userId),
    client.feature.findMany({
      where: { bucket: "core_included" },
      include: { tiers: { where: { level: "base" } }, surfaces: true },
    }),
  ]);

  const storeTools = await Promise.all(tools.map((tool) => buildStoreTool(tool, userId)));
  const storeBundles = bundles.map(buildStoreBundle);
  const coreBaseline = buildCoreBaseline(coreFeatures);

  const storePacks = packs.map((pack) => ({
    id: pack.id,
    slug: pack.slug,
    credits: pack.credits,
    priceCents: pack.priceCents,
    bestValue: pack.slug === STORE_PACK_BEST_VALUE_SLUG,
  }));

  return {
    member: {
      name: user.name ?? user.email,
      walletBalance: wallet?.balance ?? 0,
      currentBundleSlug,
    },
    tools: storeTools,
    packs: storePacks,
    bundles: storeBundles,
    coreBaseline,
    addons: STORE_ADDON_SERVICES,
    membership: { name: PLATFORM_NAME, priceCents: CORE_PRICE * 100 },
  };
}

export async function getStoreData(): Promise<StoreData> {
  const userId = await resolveSessionUserId();

  // PREVIEW-ONLY FALLBACK — see config/store.mock.ts. Same opt-in gate as the
  // launcher's; never substitutes for the session check above.
  const previewMockEnabled =
    process.env.NODE_ENV !== "production" && process.env.TOOLS_PREVIEW_MOCK_MEMBER === "1";

  if (!userId) {
    if (previewMockEnabled) return mockStoreData;
    throw new Error(
      "getStoreData(): no resolved member session, and TOOLS_PREVIEW_MOCK_MEMBER preview fallback is not enabled.",
    );
  }

  return getRealStoreData(userId, prisma);
}
