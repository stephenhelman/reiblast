import { CartMode, MemberActionType, Prisma, PrismaClient } from '@prisma/client'
import { deriveTierName } from '@/lib/catalogDerive'

type TxClient = Prisma.TransactionClient
type ReadClient = PrismaClient | TxClient

// Phase 5b — the final consent carrier. Unlike Phase 3/4 (synchronous,
// consent same-tx as the effect), checkout's effect is deferred to
// Stripe/webhook, so consent is written BEFORE mint, in its OWN tx. An
// abandoned checkout leaving an approved-but-unexecuted MemberAction is
// CORRECT — it audits "shown disclosure S, approved at T," not execution.

export type CheckoutConsentType = Extract<MemberActionType, 'subscription_add' | 'credit_pack_purchase'>

export interface CheckoutDisclosureLine {
  kind: 'subscription' | 'credit_pack'
  label: string
  priceCents: number
}

export interface CheckoutDisclosure {
  cartId: string
  mode: CartMode
  type: CheckoutConsentType
  lines: CheckoutDisclosureLine[]
  totalCents: number
  disclosureText: string
}

// Pure read — no writes. Additive paths only (a cart is never a bundle
// override, never a break/downgrade — see §3/§5), so Tier.priceCents IS the
// number to show, straight off the row: no Stripe round-trip, no "your prior
// rate may have differed" caveat Phase 3/4 needed for reprice disclosures.
export async function computeCheckoutDisclosure(client: ReadClient, params: { cartId: string }): Promise<CheckoutDisclosure> {
  const cart = await client.cart.findUniqueOrThrow({
    where: { id: params.cartId },
    include: {
      lines: {
        include: {
          tier: { include: { feature: { include: { surfaces: true } } } },
          creditPack: true,
        },
      },
    },
  })

  const lines: CheckoutDisclosureLine[] = cart.lines.map((line) => {
    if (line.tierId && line.tier) {
      const toolName = line.tier.feature.unifiedName ?? line.tier.feature.surfaces[0]?.name ?? line.tier.feature.slug
      return { kind: 'subscription', label: deriveTierName(toolName, line.tier), priceCents: line.tier.priceCents }
    }
    if (line.creditPackId && line.creditPack) {
      return { kind: 'credit_pack', label: `${line.creditPack.credits} credits`, priceCents: line.creditPack.priceCents }
    }
    throw new Error(`computeCheckoutDisclosure: CartLine ${line.id} has neither a resolvable Tier nor CreditPack`)
  })

  if (lines.length === 0) {
    throw new Error(`computeCheckoutDisclosure: cart ${params.cartId} has no lines to disclose`)
  }

  const totalCents = lines.reduce((sum, l) => sum + l.priceCents, 0)
  const type: CheckoutConsentType = cart.mode === 'subscription' ? 'subscription_add' : 'credit_pack_purchase'
  const suffix = cart.mode === 'subscription' ? '/mo' : ''

  const lineText = lines.map((l) => `${l.label}: $${(l.priceCents / 100).toFixed(2)}${suffix}`).join('; ')
  const disclosureText =
    `On ${new Date().toISOString()}, you're approving checkout for: ${lineText}. ` +
    `Total: $${(totalCents / 100).toFixed(2)}${suffix}.`

  return { cartId: cart.id, mode: cart.mode, type, lines, totalCents, disclosureText }
}

// The consent core — mirrors every other consent core here (comp.ts,
// subscriptionBreak.ts, finalizeProposal.ts): plain args, tx NON-OPTIONAL,
// writes exactly ONE MemberAction, nothing else. targetType:'Cart' is the
// add-path carrier (§6a) — distinct from Phase 4's change-path
// targetType:'AdminAction'. Serves BOTH 5b paths (member-self checkout,
// admin-staged finalize) identically: the only difference between them is
// WHICH cart's id is passed in, never the write shape.
export async function writeCheckoutConsentCore(
  tx: TxClient,
  params: { userId: string; cartId: string; disclosureText: string; type: CheckoutConsentType },
): Promise<{ memberActionId: string }> {
  const memberAction = await tx.memberAction.create({
    data: {
      userId: params.userId,
      action: params.type,
      targetType: 'Cart',
      targetId: params.cartId,
      consent: {
        timestamp: new Date().toISOString(),
        disclosureText: params.disclosureText,
        type: params.type,
      } as unknown as Prisma.InputJsonValue,
      cartId: params.cartId,
    },
  })
  return { memberActionId: memberAction.id }
}

// Orchestrates consent-then-mint WITHOUT welding them into one tx — the
// deferred-effect model (see file header) means mint runs AFTER consent's
// own tx has already committed, not inside it. `mint` is injected so this
// function is testable without touching Stripe or any Next.js action
// machinery: production wiring passes a callback that resolves the cart's
// Stripe price ids and calls mintCheckout; tests pass a spy that asserts the
// consent row already exists at the moment it's invoked.
export async function commitCheckoutConsent(
  prisma: PrismaClient,
  params: { userId: string; cartId: string; disclosureText: string; type: CheckoutConsentType },
  mint: () => Promise<void>,
): Promise<{ memberActionId: string }> {
  const result = await prisma.$transaction((tx) => writeCheckoutConsentCore(tx, params))
  await mint()
  return result
}
