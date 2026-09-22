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
import { computeBreakDisclosure } from "@/lib/engine/subscriptionBreak";
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
  // Add-path items are always a member-consensual add — never a bill-raise
  // signal (see raisesBill on ChangeReviewItem below). Carried here too so
  // callers can read item.raisesBill uniformly across the ReviewItem union.
  raisesBill: false;
}

// 5a — the member's OWN open cart (source member_self), for the store
// load-time "you still have X in your cart" reminder. Not a proposal (no
// AdminAction, no review action) — kept out of ReviewItem/getOpenChangesForMember
// on purpose so the review feed stays "proposals awaiting the member," but
// still sourced from the SAME query as the add-path items below (one
// cart.findMany call, not a second query).
export interface MemberCartReminder {
  cartId: string;
  mode: "subscription" | "credit_pack";
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
  // Derived at read time (no persisted column, §6a) — does this proposal
  // raise the member's recurring cost? A pure upgrade never does. A
  // downgrade/cancel that breaks the member's bundle qualification reprices
  // every survivor line to à la carte (§5's retention lock), which can raise
  // the net bill despite removing/downgrading one line — that's the sharp
  // case this flags. Reuses computeBreakDisclosure's own breaks/survivorLines
  // read (§5b) rather than re-deriving pricing here.
  raisesBill: boolean;
}

export type ReviewItem = AddReviewItem | ChangeReviewItem;

function entitlementLineMatches(live: EntitlementLine[], target: EntitlementLine): boolean {
  return live.some((l) => l.featureId === target.featureId && l.tierId === target.tierId && l.status === target.status);
}

// A pure upgrade is never a bill-raise (§5: more allowance, not less) — skip
// the read entirely. cancel/downgrade reuse computeBreakDisclosure's own
// `breaks` read (does this change break bundle qualification and reprice the
// survivors to à la carte?) rather than reimplementing any pricing here.
// Defensive: this is a read-surface signal, not a write path — if the
// underlying entitlement state can't support the read (e.g. the line already
// finalized out from under this candidate), fail closed to neutral rather
// than throwing on the review feed.
async function computeRaisesBill(
  client: ReadClient,
  params: { userId: string; featureId: string; action: ChangeActionType; after: EntitlementLine[] },
): Promise<boolean> {
  if (params.action === "subscription_upgrade") return false;
  try {
    if (params.action === "subscription_cancel") {
      const disclosure = await computeBreakDisclosure(client, {
        userId: params.userId,
        featureId: params.featureId,
        changeType: "cancel",
      });
      return disclosure.breaks;
    }
    const newTierId = params.after[0]?.tierId;
    if (!newTierId) return false;
    const disclosure = await computeBreakDisclosure(client, {
      userId: params.userId,
      featureId: params.featureId,
      changeType: "downgrade",
      newTierId,
    });
    return disclosure.breaks;
  } catch {
    return false;
  }
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
      raisesBill: false,
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
      const action = candidate.action as ChangeActionType;
      items.push({
        kind: "change",
        state: "consented",
        adminActionId: candidate.id,
        action,
        featureId,
        before: candidate.before as unknown as EntitlementLine[],
        after,
        raisesBill: await computeRaisesBill(client, { userId, featureId, action, after }),
      });
    } else {
      const action = candidate.action as ChangeActionType;
      items.push({
        kind: "change",
        state: "pending",
        adminActionId: candidate.id,
        action,
        featureId,
        before: candidate.before as unknown as EntitlementLine[],
        after,
        raisesBill: await computeRaisesBill(client, { userId, featureId, action, after }),
      });
    }
  }
  return items;
}

export async function getOpenChangesForMember(client: ReadClient, userId: string): Promise<ReviewItem[]> {
  const [addItems, changeItems] = await Promise.all([getOpenAddItems(client, userId), getOpenChangeItems(client, userId)]);
  return [...addItems, ...changeItems];
}

// 5a load-time reminder — "you still have X in your cart." Deliberately a
// SEPARATE query from getOpenAddItems above, not a second query on the same
// data: that one is scoped to mode:'subscription' + source in
// (admin_staged, member_self) for the review-feed's admin-proposal purpose;
// this one needs source:'member_self' across BOTH modes (subscription AND
// credit_pack — the member's own cart isn't restricted to the admin-proposal
// surface's scope). Still exactly one query, never per-mode.
export async function getMemberCartReminders(client: ReadClient, userId: string): Promise<MemberCartReminder[]> {
  const openCarts = await client.cart.findMany({
    where: { userId, status: "open", source: "member_self" },
    include: { lines: { include: { tier: { include: { feature: { include: { surfaces: true } } } } } } },
  });

  return openCarts.map((cart) => ({
    cartId: cart.id,
    mode: cart.mode,
    lines: cart.lines
      .filter((l): l is typeof l & { tierId: string; tier: NonNullable<typeof l.tier> } => l.tierId !== null && l.tier !== null)
      .map((l) => ({
        tierId: l.tierId,
        featureSlug: l.tier.feature.slug,
        tierLevel: l.tier.level,
        displayName: deriveTierName(l.tier.feature.unifiedName ?? l.tier.feature.surfaces[0]?.name ?? l.tier.feature.slug, l.tier),
        priceCents: l.tier.priceCents,
      })),
  }));
}
