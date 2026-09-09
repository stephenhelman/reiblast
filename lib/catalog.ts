// The only accessor components should use for catalog + member data.
// Internals read from the const seed today; swapping to Prisma later means
// changing the bodies of these functions, not the call sites.
//
// getMember() is server-only (it reads the session cookie via next/headers) —
// call it from a Server Component, not a Client Component. See the
// resolveMemberFromSession() comment below for the current state of real
// member resolution vs. the preview-only mock fallback.

import { cookies } from "next/headers";
import { catalog } from "@/config/catalog";
import { mockMember } from "@/config/member.mock";
import { verifyToolsSession } from "@/lib/toolsSession";
import { TOOLS_SESSION_COOKIE } from "@/lib/constants";
import type {
  Bundle,
  BundleSlug,
  Catalog,
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

export function getPacks(toolSlug?: ToolSlug): Pack[] {
  return toolSlug ? catalog.packs.filter((pack) => pack.toolSlug === toolSlug) : catalog.packs;
}

export function getBundles(): Bundle[] {
  return catalog.bundles;
}

export function getBundle(slug: BundleSlug): Bundle | undefined {
  return catalog.bundles.find((bundle) => bundle.slug === slug);
}

export function getSoloPlans(toolSlug?: ToolSlug): SoloPlan[] {
  return toolSlug
    ? catalog.soloPlans.filter((plan) => plan.toolSlug === toolSlug)
    : catalog.soloPlans;
}

export function getOpDirectServices(): OpDirectService[] {
  return catalog.opDirectServices;
}

/**
 * Verifies the session cookie and resolves it to a real member + entitlements.
 *
 * Today this can only get as far as the verified {userId, locationId} — there
 * is no member/entitlement lookup wired up yet (the CatalogTool/Bundle/...
 * and MemberEntitlement Prisma models in prisma/schema.prisma exist as the
 * target shape but nothing reads from them). So a verified session currently
 * still resolves to `null` here; once that lookup is built, this is the only
 * function that changes — getMember() and every call site stay the same.
 */
async function resolveMemberFromSession(): Promise<Member | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOOLS_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await verifyToolsSession(token);
  if (!session) return null;

  // TODO: look up the real Member + MemberEntitlements by session.locationId
  // once that Prisma wiring exists. Until then, a verified session still
  // yields no member here.
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
