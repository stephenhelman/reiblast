'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AppHeader from '@/components/shared/AppHeader'
import Button from '@/components/shared/Button'
import { portalBrand } from '@/lib/brandAssets'
import { formatCents } from '@/lib/money'
import { resolveArrival, type ParsedStoreLink, type StoreTab } from '@/lib/storeLink'
import type { StoreBundle, StoreData } from '@/types/store'
import { CreditsPanel, ToolsPanel, BundlesPanel, AddonsPanel } from './panels'
import LearnMoreModal from './LearnMoreModal'
import CartDrawer from './CartDrawer'
import type { CartItem, LearnMoreSubject } from './cartTypes'

interface StoreClientProps {
  store: StoreData
  arrival: ParsedStoreLink
  stripePublishableKey: string
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

export default function StoreClient({ store, arrival, stripePublishableKey }: StoreClientProps) {
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

  const arrivalTool = arrival.from ? tools.find((t) => t.slug === arrival.from) : undefined
  const showArrival = !!arrivalTool && !arrivalDismissed

  const addToCart = (item: CartItem) => {
    setCart((prev) => [...prev, item])
    setCartOpen(true)
  }
  const removeFromCart = (id: string) => setCart((prev) => prev.filter((i) => i.id !== id))
  const applySwap = (bundle: StoreBundle) => {
    setCart((prev) => [
      ...prev.filter((i) => !i.featureSlug || !bundle.coversFeatureSlugs.includes(i.featureSlug)),
      {
        id: bundle.id,
        kind: 'sub',
        name: `${bundle.name} bundle`,
        priceCents: bundle.priceCents,
        stripePriceId: bundle.stripePriceId,
        bundleSlug: bundle.slug,
      },
    ])
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <AppHeader
        brandSlot={
          <Link href="/" className="flex items-center gap-2.5 text-silver hover:text-white text-sm font-medium">
            <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Back to</span>
            <Image src={portalBrand.wordmark} alt="REI/tools" height={18} width={90} style={{ height: 18, width: 'auto' }} />
          </Link>
        }
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
        bundles={bundles}
        membershipName={membership.name}
        onRemove={removeFromCart}
        onApplySwap={applySwap}
        stripePublishableKey={stripePublishableKey}
      />
    </main>
  )
}
