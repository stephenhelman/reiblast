// The launcher's data path for the /tools surface — produces the
// types/launcher.ts view model. lib/storeCatalog.ts is the store's parallel
// accessor; discovery/welcome still read lib/catalog.ts (config/catalog.ts's
// const seed) as of this writing.
//
// Card status is the cross-product of two independent axes:
//   Axis 1 — Tool.active: false is terminal (coming-soon), entitlement is not checked.
//   Axis 2 — entitlement (lib/entitlement.ts + resolveFeature's allowance/balance):
//            not entitled -> locked; entitled -> accessible, sub-state from
//            remaining/balance (meter / unlimited / credits / out-of-credits).

import type { Feature, PrismaClient, Tool as PrismaTool } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveFeature } from "@/lib/engine/resolver";
import { isEntitled, hasHigherTier } from "@/lib/entitlement";
import { resolveSessionUserId } from "@/lib/toolsSession";
import { brandSlugFor } from "@/lib/brandSlug";
import { mockLauncherMember, mockLauncherTools } from "@/config/launcher.mock";
import type { AccessibleState, LauncherData, LauncherTool } from "@/types/launcher";

type ToolWithFeature = PrismaTool & { feature: Feature };

async function buildLauncherTool(tool: ToolWithFeature, userId: string): Promise<LauncherTool> {
  const base = {
    id: tool.id,
    slug: tool.slug,
    brandSlug: brandSlugFor(tool.slug),
    name: tool.name,
    tagline: tool.tagline,
    unit: tool.unit,
    href: tool.launchTarget,
    active: tool.active,
    creditCost: tool.feature.creditCost,
    unitsPerDebit: tool.feature.unitsPerDebit,
    featureSlug: tool.feature.slug,
  };

  // Axis 1 — inactive is terminal; entitlement is never checked.
  if (!tool.active) {
    return { ...base, cardStatus: "coming-soon", allowance: null, used: 0, remaining: null, hasHigherTier: false };
  }

  // Axis 2 — entitled?
  const [resolved, entitled] = await Promise.all([
    resolveFeature(prisma, userId, tool.feature.slug),
    isEntitled(prisma, userId, tool.feature),
  ]);
  const higherTier = await hasHigherTier(prisma, tool.feature.slug, resolved.level);

  if (!entitled) {
    return {
      ...base,
      cardStatus: "locked",
      allowance: resolved.allowance,
      used: resolved.used,
      remaining: resolved.remaining,
      hasHigherTier: higherTier,
    };
  }

  let accessibleState: AccessibleState;
  if (resolved.remaining === null) {
    accessibleState = "unlimited";
  } else if (resolved.remaining > 0) {
    accessibleState = "meter";
  } else if (resolved.balance > 0) {
    accessibleState = "credits";
  } else {
    accessibleState = "out-of-credits";
  }

  return {
    ...base,
    cardStatus: "accessible",
    accessibleState,
    allowance: resolved.allowance,
    used: resolved.used,
    remaining: resolved.remaining,
    hasHigherTier: higherTier,
  };
}

async function getRealLauncherData(userId: string, client: PrismaClient): Promise<LauncherData> {
  const [user, wallet, tools] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: userId } }),
    client.wallet.findUnique({ where: { userId } }),
    client.tool.findMany({ include: { feature: true }, orderBy: { createdAt: "asc" } }),
  ]);

  const launcherTools = await Promise.all(tools.map((tool) => buildLauncherTool(tool, userId)));

  return {
    member: {
      id: user.id,
      name: user.name ?? user.email,
      email: user.email,
      walletBalance: wallet?.balance ?? 0,
    },
    tools: launcherTools,
  };
}

export async function getLauncherData(): Promise<LauncherData> {
  const userId = await resolveSessionUserId(prisma);

  // PREVIEW-ONLY FALLBACK — see config/launcher.mock.ts. Gated on an explicit
  // opt-in env var (not just NODE_ENV) so it can't silently activate in a
  // misconfigured deployment. Never substitutes for the session check above;
  // middleware.ts still requires a verified session cookie to reach this route.
  const previewMockEnabled =
    process.env.NODE_ENV !== "production" && process.env.TOOLS_PREVIEW_MOCK_MEMBER === "1";

  if (!userId) {
    if (previewMockEnabled) {
      return { member: mockLauncherMember, tools: mockLauncherTools };
    }
    throw new Error(
      "getLauncherData(): no resolved member session, and TOOLS_PREVIEW_MOCK_MEMBER preview fallback is not enabled.",
    );
  }

  return getRealLauncherData(userId, prisma);
}
