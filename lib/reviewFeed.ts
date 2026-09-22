// Phase 4 — the "changes to review" feed. Read-only union of open proposals
// awaiting the member (§6a): (a) open admin_staged Carts (the ADD path) and
// (b) open change proposals (AdminAction subscription_upgrade/downgrade/
// cancel with no MemberAction back-pointer yet, or one that hasn't landed).
//
// NO mutable status column drives this — every state is DERIVED from
// existing rows (Cart.status, MemberAction existence, live Subscription vs
// AdminAction.after), exactly as §6a locks it.

import type { AdminActionType, PrismaClient, Prisma, TierLevel } from "@prisma/client";
import { projectEntitlementLines, type EntitlementLine } from "@/lib/engine/comp";
import { deriveTierName } from "@/lib/catalogDerive";

type ReadClient = PrismaClient | Prisma.TransactionClient;

export type ReviewState = "pending" | "consented";

export interface AddReviewLine {
  tierId: string;
  featureSlug: string;
  tierLevel: TierLevel;
  displayName: string;
  priceCents: number;
}

export interface AddReviewItem {
  kind: "add";
  state: ReviewState;
  cartId: string;
  adminActionId: string;
  lines: AddReviewLine[];
}

const CHANGE_ACTION_TYPES: AdminActionType[] = ["subscription_upgrade", "subscription_downgrade", "subscription_cancel"];
type ChangeActionType = (typeof CHANGE_ACTION_TYPES)[number];

export interface ChangeReviewItem {
  kind: "change";
  state: ReviewState;
  adminActionId: string;
  action: ChangeActionType;
  featureId: string;
  before: EntitlementLine[];
  after: EntitlementLine[];
}

export type ReviewItem = AddReviewItem | ChangeReviewItem;

function entitlementLineMatches(live: EntitlementLine[], target: EntitlementLine): boolean {
  return live.some((l) => l.featureId === target.featureId && l.tierId === target.tierId && l.status === target.status);
}

// (a) open admin_staged Carts — the ADD path. member_self is included for
// forward-safety per the design note (member_self carts aren't produced yet;
// expect none in practice), but only carts with a staged-by AdminAction
// (admin_staged) are reviewable here — Phase 5 owns member-initiated cart
// production and its own consent flow.
async function getOpenAddItems(client: ReadClient, userId: string): Promise<AddReviewItem[]> {
  const openCarts = await client.cart.findMany({
    where: { userId, mode: "subscription", status: "open", source: { in: ["admin_staged", "member_self"] } },
    include: { lines: { include: { tier: { include: { feature: { include: { surfaces: true } } } } } } },
  });

  const items: AddReviewItem[] = [];
  for (const cart of openCarts) {
    if (!cart.adminActionId) continue; // no staged-by AdminAction to review yet — not this phase's concern

    const memberAction = await client.memberAction.findFirst({
      where: { userId, targetType: "Cart", targetId: cart.id },
    });

    items.push({
      kind: "add",
      state: memberAction ? "consented" : "pending",
      cartId: cart.id,
      adminActionId: cart.adminActionId,
      lines: cart.lines
        .filter((l): l is typeof l & { tierId: string; tier: NonNullable<typeof l.tier> } => l.tierId !== null && l.tier !== null)
        .map((l) => ({
          tierId: l.tierId,
          featureSlug: l.tier.feature.slug,
          tierLevel: l.tier.level,
          displayName: deriveTierName(l.tier.feature.unifiedName ?? l.tier.feature.surfaces[0]?.name ?? l.tier.feature.slug, l.tier),
          priceCents: l.tier.priceCents,
        })),
    });
  }
  return items;
}

// (b) open change proposals. AdminAction's OWN target for these three action
// types is ALWAYS targetType 'subscription' (see lib/engine/adminProposals.ts
// #proposeSubscriptionChangeCore) — distinct from cart_stage/subscription_comp,
// which use targetType 'user'. Never assume the latter shape here.
async function getOpenChangeItems(client: ReadClient, userId: string): Promise<ChangeReviewItem[]> {
  const memberSubs = await client.subscription.findMany({ where: { userId }, select: { id: true } });
  const subIds = memberSubs.map((s) => s.id);
  if (subIds.length === 0) return [];

  const candidates = await client.adminAction.findMany({
    where: { targetType: "subscription", targetId: { in: subIds }, action: { in: CHANGE_ACTION_TYPES } },
    orderBy: { createdAt: "desc" },
  });

  const items: ChangeReviewItem[] = [];
  for (const candidate of candidates) {
    const after = candidate.after as unknown as EntitlementLine[];
    const featureId = after[0]?.featureId;
    if (!featureId) continue; // malformed projection — skip rather than throw on a read surface

    // The anti-join: has the MEMBER already responded to THIS proposal? Keyed
    // by the 'AdminAction' back-pointer (§6a) — never the generic
    // targetType:'subscription' MemberAction breakSubscriptionCore itself
    // writes, which points at the landed Subscription row, not the proposal.
    const memberAction = await client.memberAction.findFirst({
      where: { userId, targetType: "AdminAction", targetId: candidate.id },
    });

    if (memberAction) {
      // A back-pointer exists — has the effect actually landed? Finalize-
      // detection is set-equality against live Subscription rows (§6a), never
      // a stored status. If it matches, this proposal is FINALIZED — drop it
      // (absence IS the finalized state).
      const live = await projectEntitlementLines(client, userId, featureId);
      const landed = after.every((line) => entitlementLineMatches(live, line));
      if (landed) continue;
      items.push({
        kind: "change",
        state: "consented",
        adminActionId: candidate.id,
        action: candidate.action as ChangeActionType,
        featureId,
        before: candidate.before as unknown as EntitlementLine[],
        after,
      });
    } else {
      items.push({
        kind: "change",
        state: "pending",
        adminActionId: candidate.id,
        action: candidate.action as ChangeActionType,
        featureId,
        before: candidate.before as unknown as EntitlementLine[],
        after,
      });
    }
  }
  return items;
}

export async function getOpenChangesForMember(client: ReadClient, userId: string): Promise<ReviewItem[]> {
  const [addItems, changeItems] = await Promise.all([getOpenAddItems(client, userId), getOpenChangeItems(client, userId)]);
  return [...addItems, ...changeItems];
}
