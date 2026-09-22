import { CartMode, Prisma } from '@prisma/client'
import type { EntitlementLine } from './comp'

type TxClient = Prisma.TransactionClient

export interface CartLineRef {
  tierId?: string
  creditPackId?: string
}

// Exactly-one-ref-matching-mode (§3 stores-zero-numbers discipline extends to
// "exactly one catalog ref" too — a CartLine with both/neither is DB-valid
// but app-invalid). Rejects rather than silently picking one.
function validateLines(lines: CartLineRef[]): void {
  for (const line of lines) {
    const hasTier = !!line.tierId
    const hasPack = !!line.creditPackId
    if (hasTier === hasPack) {
      throw new Error('memberCart: each CartLine must have exactly one catalog ref (tierId XOR creditPackId), got ' + JSON.stringify(line))
    }
  }
}

export type UpsertMemberCartResult =
  | { ok: true; cartId: string | null }
  | { blocked: 'admin_proposal_pending'; cartId: string }

// DIRECTION 1 — the member's own live cart (5a). Check-then-write in ONE tx:
// BEFORE writing, check for an open cart in this (userId, mode). If it's
// admin_staged, do NOT write — return a blocked signal so the caller routes
// the member to the proposal instead of silently clobbering it. If it's
// member_self (or absent), write/update it in place. Passing an empty
// `lines` array expires the existing member_self cart (nothing to keep
// open) rather than leaving a zero-line open row.
export async function upsertMemberCartCore(
  tx: TxClient,
  params: { userId: string; mode: CartMode; lines: CartLineRef[] },
): Promise<UpsertMemberCartResult> {
  validateLines(params.lines)

  const existingOpenCart = await tx.cart.findFirst({
    where: { userId: params.userId, mode: params.mode, status: 'open' },
  })

  if (existingOpenCart?.source === 'admin_staged') {
    return { blocked: 'admin_proposal_pending', cartId: existingOpenCart.id }
  }

  if (params.lines.length === 0) {
    if (existingOpenCart) {
      await tx.cart.update({ where: { id: existingOpenCart.id }, data: { status: 'expired' } })
      return { ok: true, cartId: existingOpenCart.id }
    }
    return { ok: true, cartId: null }
  }

  // Same cart, updated in place — never a new row when one is already open
  // (the partial-unique index would reject a second one anyway).
  const cart =
    existingOpenCart ?? (await tx.cart.create({ data: { userId: params.userId, mode: params.mode, status: 'open', source: 'member_self' } }))

  await tx.cartLine.deleteMany({ where: { cartId: cart.id } })
  await tx.cartLine.createMany({
    data: params.lines.map((line) => ({ cartId: cart.id, tierId: line.tierId ?? null, creditPackId: line.creditPackId ?? null })),
  })

  return { ok: true, cartId: cart.id }
}

// DIRECTION 2 — the admin's confirmed override (5a). Caller (the admin
// server action) already ran the check-then-block step (see
// lib/engine/adminProposals.ts#stageSubscriptionAddCore's
// requiresOverrideConfirm branch) and the admin explicitly confirmed on this
// second call — this core does the actual destructive part, atomically:
// expire the member_self cart, stage the admin_staged replacement, and write
// the cart_override AdminAction recording the admin's attestation that the
// member agreed on a call. Order matters — expire BEFORE creating the new
// cart, or the partial-unique (userId, mode) WHERE status='open' index
// throws P2002 (two carts open at once, even transiently in one tx, is not
// allowed — this is the backstop, not a bug to route around here).
export async function overrideMemberCartCore(
  tx: TxClient,
  params: {
    adminUserId: string
    memberUserId: string
    mode: CartMode
    proposalTierIds: string[]
    note?: string
  },
): Promise<{ adminActionId: string; cartId: string }> {
  const memberCart = await tx.cart.findFirst({
    where: { userId: params.memberUserId, mode: params.mode, status: 'open', source: 'member_self' },
    include: { lines: true },
  })
  if (!memberCart) {
    throw new Error(
      `overrideMemberCartCore: no open member_self cart for user ${params.memberUserId} (mode ${params.mode}) to override`,
    )
  }

  const discardedTierIds = memberCart.lines.flatMap((l) => (l.tierId ? [l.tierId] : []))
  const [beforeTiers, afterTiers] = await Promise.all([
    tx.tier.findMany({ where: { id: { in: discardedTierIds } } }),
    tx.tier.findMany({ where: { id: { in: params.proposalTierIds } } }),
  ])

  // projectEntitlementLines' [{featureId,tierId,status}] shape, reused for
  // consistency even though these are Cart lines, not Subscription rows —
  // 'discarded'/'staged' are the honest labels for what actually happened,
  // not a claim about entitlement state.
  const before: EntitlementLine[] = beforeTiers.map((t) => ({ featureId: t.featureId, tierId: t.id, status: 'discarded' }))
  const after: EntitlementLine[] = afterTiers.map((t) => ({ featureId: t.featureId, tierId: t.id, status: 'staged' }))

  const adminAction = await tx.adminAction.create({
    data: {
      adminUserId: params.adminUserId,
      action: 'cart_override',
      targetType: 'user',
      targetId: params.memberUserId,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      note: params.note ?? "Admin confirmed the member's verbal agreement (on a call) to replace their in-progress cart.",
    },
  })

  // Expire BEFORE creating — see the ordering note above.
  await tx.cart.update({ where: { id: memberCart.id }, data: { status: 'expired' } })

  const newCart = await tx.cart.create({
    data: {
      userId: params.memberUserId,
      mode: params.mode,
      status: 'open',
      source: 'admin_staged',
      adminActionId: adminAction.id,
    },
  })
  await tx.cartLine.createMany({ data: params.proposalTierIds.map((tierId) => ({ cartId: newCart.id, tierId })) })

  return { adminActionId: adminAction.id, cartId: newCart.id }
}

// The member declining an admin's staged proposal (Direction 1's deny path)
// — just expires the cart, freeing the (userId, mode) slot. No AdminAction,
// no MemberAction: declining isn't itself a proposal or a consent event: the
// audit trail here is what the admin already wrote (cart_stage/cart_override);
// its absence of a MemberAction back-pointer IS the record that nothing was
// accepted (§6a's own derivation rule — same principle, applied to "never
// consented" rather than "consented").
export async function declineStagedCartCore(tx: TxClient, params: { userId: string; cartId: string }): Promise<void> {
  const cart = await tx.cart.findFirst({
    where: { id: params.cartId, userId: params.userId, status: 'open', source: 'admin_staged' },
  })
  if (!cart) {
    throw new Error(`declineStagedCartCore: no open admin_staged cart ${params.cartId} for user ${params.userId}`)
  }
  await tx.cart.update({ where: { id: cart.id }, data: { status: 'expired' } })
}
