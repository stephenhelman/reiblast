'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AppHeader from '@/components/shared/AppHeader'
import Button from '@/components/shared/Button'
import { portalBrand } from '@/lib/brandAssets'
import { formatCents } from '@/lib/money'
import { resolveArrival, type ParsedStoreLink, type StoreTab } from '@/lib/storeLink'
import type { StoreBundle, StoreData } from '@/types/store'
import type { MemberCartReminder } from '@/lib/reviewFeed'
import { syncMemberCartAction, declineStagedCartAction } from '@/app/tools/store/cartActions'
import type { CartLineRef } from '@/lib/engine/memberCart'
import { CreditsPanel, ToolsPanel, BundlesPanel, AddonsPanel } from './panels'
import LearnMoreModal from './LearnMoreModal'
import CartDrawer from './CartDrawer'
import { composeBundleCartItem, type CartItem, type LearnMoreSubject } from './cartTypes'

interface StoreClientProps {
  store: StoreData
  arrival: ParsedStoreLink
  stripePublishableKey: string
  /** 5a — the member's own open cart(s), server-fetched (getMemberCartReminders). Drives the "you still have X in your cart" banner below. */
  cartReminders: MemberCartReminder[]
}

// Local cart -> the DB refs 5a's live write-through needs, split by mode
// (Cart is single-intent — subscription vs credit_pack — mirroring
// mintCheckout's own mixed-cart rejection). 'once' items (op-direct) are
// never synced: no Tier row exists for them.
function deriveCartRefs(cart: CartItem[]): { subscription: CartLineRef[]; creditPack: CartLineRef[] } {
  const subscription: CartLineRef[] = []
  const creditPack: CartLineRef[] = []
  for (const item of cart) {
    if (item.kind === 'credits' && item.creditPackId) {
      creditPack.push({ creditPackId: item.creditPackId })
    } else if (item.kind === 'sub') {
      if (item.lines && item.lines.length > 0) {
        for (const line of item.lines) subscription.push({ tierId: line.tierId })
      } else if (item.tierId) {
        subscription.push({ tierId: item.tierId })
      }
    }
  }
  return { subscription, creditPack }
}

const TABS: { id: StoreTab; label: string }[] = [
  { id: 'credits', label: 'Credits' },
  { id: 'tools', label: 'Tools' },
  { id: 'bundles', label: 'Bundles' },
  { id: 'addons', label: 'Add-ons' },
]

function CartIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 6h15l-1.5 9h-12z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 6L5 3H2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="20" r="1.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="20" r="1.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export default function StoreClient({ store, arrival, stripePublishableKey, cartReminders }: StoreClientProps) {
  const { member, tools, packs, bundles, coreBaseline, addons, membership } = store

  // Resolved once against the fetched catalog (hasHigherTier is precomputed
  // onto each tool server-side) — this decides the REAL tab/open-state,
  // arrival.tab is just parseStoreLink's naive pre-resolution guess.
  const [resolved] = useState(() => resolveArrival(arrival, tools))

  const [activeTab, setActiveTab] = useState<StoreTab>(resolved.tab)
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [learnMoreSubject, setLearnMoreSubject] = useState<LearnMoreSubject | null>(
    resolved.openToolSlug ? { kind: 'tool', toolSlug: resolved.openToolSlug } : null,
  )
  const [arrivalDismissed, setArrivalDismissed] = useState(false)
  const [reminders, setReminders] = useState(cartReminders)
  const [remindersDismissed, setRemindersDismissed] = useState(false)
  const [proposalBlocked, setProposalBlocked] = useState<{ mode: 'subscription' | 'credit_pack'; cartId: string } | null>(null)
  // The DB cart ids the live write-through last synced to — 5b's checkout
  // consent flow needs the real cartId (its disclosure + MemberAction both
  // key off it), never a client-only concept.
  const [dbCartIds, setDbCartIds] = useState<{ subscription: string | null; creditPack: string | null }>({
    subscription: null,
    creditPack: null,
  })

  const arrivalTool = arrival.from ? tools.find((t) => t.slug === arrival.from) : undefined
  const showArrival = !!arrivalTool && !arrivalDismissed
  const showReminders = reminders.length > 0 && !remindersDismissed && cart.length === 0

  const addToCart = (item: CartItem) => {
    setCart((prev) => [...prev, item])
    setCartOpen(true)
  }
  const removeFromCart = (id: string) => setCart((prev) => prev.filter((i) => i.id !== id))
  const toolNames = Object.fromEntries(tools.map((t) => [t.featureSlug, t.name]))

  // Live write-through (5a, Direction 1) — the DB write is the source of
  // truth; local `cart` state stays for snappy rendering, but every change
  // syncs to the member's own Cart/CartLine rows. Skips the very first
  // render (cart starts empty; nothing to sync until the member acts) and
  // whenever a blocked proposal is already showing (don't keep re-writing
  // against a slot an admin_staged cart occupies).
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const { subscription, creditPack } = deriveCartRefs(cart)

    async function sync() {
      const [subResult, packResult] = await Promise.all([
        syncMemberCartAction('subscription', subscription),
        syncMemberCartAction('credit_pack', creditPack),
      ])
      if ('blocked' in subResult) setProposalBlocked({ mode: 'subscription', cartId: subResult.cartId })
      else if ('blocked' in packResult) setProposalBlocked({ mode: 'credit_pack', cartId: packResult.cartId })
      else setProposalBlocked(null)

      setDbCartIds({
        subscription: 'ok' in subResult ? subResult.cartId : null,
        creditPack: 'ok' in packResult ? packResult.cartId : null,
      })
    }
    sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart])

  function checkoutReminder() {
    setRemindersDismissed(true)
    setCartOpen(true)
    // The drawer reads local `cart`; a full browser->DB cart rehydrate is
    // Phase 5b's checkout-finalize concern, not this wiring pass — the
    // reminder's "checkout" affordance opens the drawer the member already
    // has context for.
  }
  // Removes the MEMBER'S OWN reminded cart (source member_self) — clears it
  // via the same live write-through path (empty lines expires it in
  // upsertMemberCartCore), never declineStagedCartAction, which is scoped to
  // an ADMIN's staged proposal, a different case entirely.
  function removeReminder(cartId: string, mode: 'subscription' | 'credit_pack') {
    setReminders((prev) => prev.filter((r) => r.cartId !== cartId))
    void syncMemberCartAction(mode, []).catch(() => {})
  }
  // The proposal-route: the member's add hit an admin_staged cart already
  // occupying this slot. Declining frees the slot so their own add can
  // proceed on retry; nothing here writes an entitlement or a MemberAction.
  function declineProposal() {
    if (!proposalBlocked) return
    const { cartId } = proposalBlocked
    void declineStagedCartAction(cartId).then(() => setProposalBlocked(null))
  }
  // Cart is single-intent by construction (checkout already enforces this) —
  // the DB cartId 5b's consent flow needs is whichever mode the local items
  // actually are.
  const cartMode: 'subscription' | 'credit_pack' | null = cart.some((i) => i.kind === 'credits')
    ? 'credit_pack'
    : cart.some((i) => i.kind === 'sub')
      ? 'subscription'
      : null
  const activeCartId = cartMode === 'subscription' ? dbCartIds.subscription : cartMode === 'credit_pack' ? dbCartIds.creditPack : null

  const applySwap = (bundle: StoreBundle) => {
    setCart((prev) => [
      ...prev.filter((i) => !i.featureSlug || !bundle.coversFeatureSlugs.includes(i.featureSlug)),
      composeBundleCartItem(bundle, toolNames),
    ])
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <AppHeader
        brandSlot={<Image src={portalBrand.wordmark} alt="REI/tools" height={30} width={140} style={{ height: 30, width: 'auto' }} />}
        role={member.role}
        account={{ name: member.name, creditBalance: member.walletBalance }}
        actionSlot={
          <div className="flex items-center gap-3">
            <Button variant="gold" size="sm" onClick={() => setActiveTab('credits')}>
              Get credits
            </Button>
            <button
              onClick={() => setCartOpen(true)}
              aria-label="Cart"
              className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-border-default bg-surface text-white hover:border-gold-hover"
            >
              <CartIcon className="h-4.75 w-4.75" />
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-black">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        }
      />

      <div className="max-w-300 w-full mx-auto px-6 md:px-12 lg:px-16 pt-8 pb-24">
        <div>
          <h1 className="text-2xl font-semibold">Store</h1>
          <p className="text-gray text-sm mt-1">Add credits, subscribe to tools, move up a bundle, or book a done-for-you service.</p>
          <p className="text-[12.5px] text-gray mt-2">
            Everything here is{' '}
            <b className="text-silver font-semibold">
              separate from your {formatCents(membership.priceCents)}/mo {membership.name} membership
            </b>{' '}
            and billed on top of it — your CRM subscription stays exactly as it is.
          </p>
        </div>

        {showArrival && arrivalTool && (
          <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-gold/10 border border-gold-hover px-3.5 py-2.25 text-[12.7px] text-gold">
            <span>
              Coming from <b className="text-white">{arrivalTool.name}</b>
              {arrival.intent === 'credits' ? ` — showing credits, in ${arrivalTool.unit}.` : '.'}
            </span>
            <button onClick={() => setArrivalDismissed(true)} className="ml-auto text-gold/70 hover:text-gold">
              ×
            </button>
          </div>
        )}

        {/* 5a load-time reminder — "you still have X in your cart" */}
        {showReminders &&
          reminders.map((reminder) => (
            <div
              key={reminder.cartId}
              className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg bg-surface border border-border-default px-3.5 py-2.25 text-[12.7px] text-silver"
            >
              <span>
                You still have{' '}
                <b className="text-white">{reminder.lines.map((l) => l.displayName).join(', ')}</b> in your cart.
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => checkoutReminder()} className="text-gold hover:text-gold-hover font-semibold">
                  Checkout
                </button>
                <button onClick={() => removeReminder(reminder.cartId, reminder.mode)} className="text-silver/70 hover:text-white">
                  Remove
                </button>
              </div>
            </div>
          ))}

        {/* 5a Direction 1 — an admin's staged proposal occupies this slot */}
        {proposalBlocked && (
          <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg bg-gold/10 border border-gold-hover px-3.5 py-2.25 text-[12.7px] text-gold">
            <span>
              An admin has proposed a change to your{' '}
              {proposalBlocked.mode === 'subscription' ? 'subscription' : 'credits'} cart. Review it before adding more.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/tools/account" className="text-gold hover:text-gold-hover font-semibold">
                Review
              </Link>
              <button onClick={declineProposal} className="text-gold/70 hover:text-gold">
                Decline &amp; start my own
              </button>
            </div>
          </div>
        )}

        <nav className="flex gap-5.5 mt-5.5 mb-6.5 border-b border-border-default">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-2.5 text-sm font-medium ${
                activeTab === tab.id ? 'text-gold' : 'text-silver hover:text-white'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-t bg-gold" />}
            </button>
          ))}
        </nav>

        {activeTab === 'credits' && (
          <CreditsPanel
            tools={tools}
            packs={packs}
            initialToolSlug={resolved.creditsToolSlug ?? undefined}
            upgradeMaxedToolSlug={resolved.upgradeMaxedToolSlug}
            onAddToCart={addToCart}
          />
        )}
        {activeTab === 'tools' && <ToolsPanel tools={tools} onLearnMore={setLearnMoreSubject} />}
        {activeTab === 'bundles' && (
          <BundlesPanel
            coreBaseline={coreBaseline}
            bundles={bundles}
            membershipName={membership.name}
            membershipPriceCents={membership.priceCents}
            currentBundleSlug={member.currentBundleSlug}
            onLearnMore={setLearnMoreSubject}
          />
        )}
        {activeTab === 'addons' && <AddonsPanel services={addons} onLearnMore={setLearnMoreSubject} />}
      </div>

      <LearnMoreModal
        subject={learnMoreSubject}
        tools={tools}
        bundles={bundles}
        services={addons}
        membershipName={membership.name}
        onClose={() => setLearnMoreSubject(null)}
        onAddToCart={addToCart}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        cartId={activeCartId}
        bundles={bundles}
        tools={tools}
        packs={packs}
        membershipName={membership.name}
        onRemove={removeFromCart}
        onApplySwap={applySwap}
        stripePublishableKey={stripePublishableKey}
      />
    </main>
  )
}
