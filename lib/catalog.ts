// The only accessor components should use for catalog + member data.
// Internals read from the const seed today; swapping to Prisma later means
// changing the bodies of these functions, not the call sites.
//
// getMember() is server-only (it reads the session cookie via next/headers) —
// call it from a Server Component, not a Client Component. See the
// resolveMemberFromSession() comment below for the current state of real
// member resolution vs. the preview-only mock fallback.

import { catalog } from "@/config/catalog";
import { mockMember } from "@/config/member.mock";
import { prisma } from "@/lib/prisma";
import { resolveSessionUserId } from "@/lib/toolsSession";
import type {
  Bundle,
  BundleSlug,
  Catalog,
  EntitlementKey,
  Member,
  OpDirectService,
  Pack,
  SoloPlan,
  Tool,
  ToolSlug,
} from "@/types/catalog";

export function getCatalog(): Catalog {
  return catalog;
}

export function getTools(): Tool[] {
  return catalog.tools;
}

export function getTool(slug: ToolSlug): Tool | undefined {
  return catalog.tools.find((tool) => tool.slug === slug);
}

/** Packs are universal (shared-wallet credits) — no tool filter to apply. */
export function getPacks(): Pack[] {
  return catalog.packs;
}

/** Purchasable bundles only (Plus/Pro) — for the store's Bundles tab list. */
export function getBundles(): Bundle[] {
  return catalog.bundles;
}

/** The non-purchasable Core reference baseline — render separately, never in a purchasable list. */
export function getCoreBaseline(): Bundle {
  return catalog.coreBaseline;
}

/** Resolves a bundle by slug for allowance/coverage lookups — checks purchasable bundles AND the Core baseline, since a member's bundleSlug can be "core". */
export function getBundle(slug: BundleSlug): Bundle | undefined {
  if (slug === catalog.coreBaseline.slug) return catalog.coreBaseline;
  return catalog.bundles.find((bundle) => bundle.slug === slug);
}

export function getSoloPlans(entitlementKey?: EntitlementKey): SoloPlan[] {
  return entitlementKey
    ? catalog.soloPlans.filter((plan) => plan.entitlementKey === entitlementKey)
    : catalog.soloPlans;
}

export function getOpDirectServices(): OpDirectService[] {
  return catalog.opDirectServices;
}

export function getMembership(): Catalog["membership"] {
  return catalog.membership;
}

/**
 * Verifies the session cookie and resolves it to a real member + entitlements.
 *
 * resolveSessionUserId() (lib/toolsSession.ts) now gets us the real User.id.
 * What's still unbuilt is mapping that id to this file's const-seed-era
 * `Member` shape — the CatalogTool/Bundle/... and MemberEntitlement Prisma
 * models this type mirrors were superseded by the Feature/Tool/Tier engine
 * (see lib/launcherCatalog.ts / lib/storeCatalog.ts, which read the engine
 * directly and don't go through this `Member` type at all). This function
 * has no live callers today; left resolving to `null` until/unless something
 * needs the legacy Member shape built from the engine.
 */
async function resolveMemberFromSession(): Promise<Member | null> {
  const userId = await resolveSessionUserId(prisma);
  if (!userId) return null;

  // TODO: map the real User (id: userId) to this file's legacy Member shape
  // once/if a caller needs it — see comment above.
  return null;
}

export async function getMember(): Promise<Member> {
  const resolved = await resolveMemberFromSession();
  if (resolved) return resolved;

  // PREVIEW-ONLY FALLBACK. Never runs in production, and never substitutes
  // for a real session — middleware.ts still requires a verified session
  // cookie to reach any tools route in the first place. This only covers the
  // gap where a session verifies but real member/entitlement resolution
  // isn't wired up yet (see resolveMemberFromSession above), so local preview
  // isn't blocked on that. Gated on an explicit opt-in env var, not just
  // NODE_ENV, so it can't silently activate on a misconfigured deployment.
  const previewMockEnabled =
    process.env.NODE_ENV !== "production" && process.env.TOOLS_PREVIEW_MOCK_MEMBER === "1";

  if (previewMockEnabled) {
    return mockMember;
  }

  throw new Error(
    "getMember(): no resolved member session, and TOOLS_PREVIEW_MOCK_MEMBER preview fallback is not enabled.",
  );
}
