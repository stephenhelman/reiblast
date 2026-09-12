'use client'

import { useEffect, useState } from 'react'
import DiscoveryHeader from './DiscoveryHeader'
import ProductCard, { type DiscoveryCardData } from './ProductCard'
import LearnMoreModal, { type DiscoveryLearnMoreSubject } from './LearnMoreModal'
import ListPanel from './ListPanel'
import InfoModal from './InfoModal'
import WebsiteInterstitial from './WebsiteInterstitial'
import ExitIntentModal from './ExitIntentModal'
import Button from '@/components/shared/Button'
import Drawer from '@/components/shared/Drawer'
import { getBrandAssets, portalBrand } from '@/lib/brandAssets'
import { clearOnboardingCookieAction, submitDiscoveryListAction, type DiscoverySubmitPayloads } from '@/app/marketing/discovery/actions'
import type { OnboardingIdentity } from '@/lib/onboardingSession'
import type { DiscoveryCatalog, DiscoveryListItem } from '@/types/discovery'

const LIST_STORAGE_KEY = 'reiblast_discovery_list'
const SEEN_INTERSTITIAL_KEY = 'reiblast_discovery_seen_interstitial'
const SEEN_EXIT_KEY = 'reiblast_discovery_seen_exit'

interface DiscoveryClientProps {
  catalog: DiscoveryCatalog
  cookieIdentity: OnboardingIdentity | null
  emailHint: string | null
  /** Dev-only — lets you flip cookie-present/absent without a real onboarding submit. */
  showPreviewControls: boolean
}

function readStoredList(): DiscoveryListItem[] {
  try {
    const raw = sessionStorage.getItem(LIST_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DiscoveryListItem[]) : []
  } catch {
    return []
  }
}

export default function DiscoveryClient({ catalog, cookieIdentity, emailHint, showPreviewControls }: DiscoveryClientProps) {
  const [list, setList] = useState<DiscoveryListItem[]>([])
  const [learnMoreSubject, setLearnMoreSubject] = useState<DiscoveryLearnMoreSubject | null>(null)
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [interstitialOpen, setInterstitialOpen] = useState(false)
  const [exitIntentOpen, setExitIntentOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [debugPayloads, setDebugPayloads] = useState<DiscoverySubmitPayloads | null>(null)
  // Dev-only preview override — every bundle is coming-soon at real launch
  // (their covered tools aren't active yet), so this is the only way to see
  // the active-state modal's Plus/Pro tier listings without flipping real
  // Tool.active rows in the DB. Never affects catalog data, just this render.
  const [forceBundlingActive, setForceBundlingActive] = useState(false)
  // Mobile-only — the list panel is a fixed sidebar on desktop (lg+) but a
  // drawer/sheet on phones, triggered by a floating button.
  const [listDrawerOpen, setListDrawerOpen] = useState(false)

  // List lives in sessionStorage — clears itself when the tab/session ends,
  // which is the "clear-on-close" behavior this needs; no extra logic required.
  useEffect(() => {
    setList(readStoredList())
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(LIST_STORAGE_KEY, JSON.stringify(list))
    } catch {
      // sessionStorage unavailable (private mode etc.) — list just won't persist across reloads.
    }
  }, [list])

  // Website interstitial — once per session, after a short delay.
  useEffect(() => {
    if (sessionStorage.getItem(SEEN_INTERSTITIAL_KEY)) return
    const timer = setTimeout(() => {
      setInterstitialOpen(true)
      sessionStorage.setItem(SEEN_INTERSTITIAL_KEY, '1')
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  // Exit-intent — once per session, never blocks.
  useEffect(() => {
    if (sessionStorage.getItem(SEEN_EXIT_KEY)) return
    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0 && !sessionStorage.getItem(SEEN_EXIT_KEY)) {
        setExitIntentOpen(true)
        sessionStorage.setItem(SEEN_EXIT_KEY, '1')
      }
    }
    document.addEventListener('mouseleave', handleMouseLeave)
    return () => document.removeEventListener('mouseleave', handleMouseLeave)
  }, [])

  const addToList = (item: DiscoveryListItem) => {
    setList((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]))
  }
  const removeFromList = (id: string) => setList((prev) => prev.filter((i) => i.id !== id))

  // Preview-only override applied at render time — see forceBundlingActive above.
  const displayCatalog: DiscoveryCatalog =
    showPreviewControls && forceBundlingActive
      ? { ...catalog, bundling: { ...catalog.bundling, status: 'active' } }
      : catalog

  const cards: DiscoveryCardData[] = [
    ...displayCatalog.tools.map((tool) => ({
      key: `tool-${tool.slug}`,
      wordmark: getBrandAssets(tool.brandSlug).wordmark,
      name: tool.name,
      blurb: tool.tagline,
      status: tool.status,
    })),
    // REItools is ONE product with a tier ladder — one card, never one per bundle tier.
    // This is about bundling their TOOLS, distinct from the REItools platform they're
    // already using — the copy says "your tools," never "REItools together."
    {
      key: 'bundling',
      wordmark: portalBrand.wordmark,
      name: 'REItools bundling',
      blurb:
        displayCatalog.bundling.status === 'active'
          ? 'Save by bundling — get more of your tools for less than buying each separately.'
          : 'Bundle your tools — get more for less than buying each separately.',
      status: displayCatalog.bundling.status,
    },
    ...catalog.addons.map((service) => ({
      key: `service-${service.slug}`,
      wordmark: service.toolSlug ? getBrandAssets(service.toolSlug).wordmark : portalBrand.wordmark,
      name: service.name,
      // Op-direct services are never gated — always render as available.
      blurb: service.tagline,
      status: 'active' as const,
    })),
  ]

  const handleLearnMore = (card: DiscoveryCardData) => {
    if (card.key.startsWith('tool-')) setLearnMoreSubject({ kind: 'tool', toolSlug: card.key.slice('tool-'.length) })
    else if (card.key === 'bundling') setLearnMoreSubject({ kind: 'bundling' })
    else setLearnMoreSubject({ kind: 'service', serviceId: catalog.addons.find((s) => `service-${s.slug}` === card.key)?.id ?? '' })
  }

  const siteAddon = catalog.addons.find((s) => s.slug === 'site')

  // The modal collects/confirms identity itself (autofilled from the cookie or
  // blank), then calls this with whatever it settled on.
  const handleInfoSubmit = async (identity: OnboardingIdentity) => {
    setSubmitting(true)
    const payloads = await submitDiscoveryListAction(
      { contactId: identity.contactId || null, name: identity.name, email: identity.email, phone: identity.phone },
      list.map((item) => item.slug),
    )
    setDebugPayloads(payloads)
    setSubmitting(false)
    setSubmitted(true)
    setInfoModalOpen(false)
    try {
      sessionStorage.removeItem(LIST_STORAGE_KEY)
    } catch {
      // no-op
    }
  }

  const sidebarPanel = (
    <>
      <ListPanel
        list={list}
        onRemove={removeFromList}
        onReady={() => {
          setListDrawerOpen(false)
          setInfoModalOpen(true)
        }}
        submitting={submitting}
        submitted={submitted}
      />

      {showPreviewControls && (
        <div className="mt-4 rounded-lg border border-border-default bg-surface px-3.5 py-3 text-[11.5px] text-silver flex flex-col gap-2">
          <div className="font-semibold text-white">Preview controls (dev only)</div>
          <form action={clearOnboardingCookieAction}>
            <Button type="submit" variant="quiet" size="sm">
              Simulate: clear onboarding cookie
            </Button>
          </form>
          <p>Cookie present: {cookieIdentity ? 'yes' : 'no'} (drives the info modal's autofill)</p>
          <Button variant="quiet" size="sm" onClick={() => setForceBundlingActive((v) => !v)}>
            Simulate: force REItools bundle {forceBundlingActive ? 'coming-soon' : 'active'}
          </Button>
          <p>Bundle status shown: {displayCatalog.bundling.status}</p>
          {debugPayloads && (
            <pre className="whitespace-pre-wrap text-[10.5px] bg-black rounded-md p-2 mt-1">
              {JSON.stringify(debugPayloads, null, 2)}
            </pre>
          )}
        </div>
      )}
    </>
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <DiscoveryHeader />

      <div className="max-w-300 w-full mx-auto px-4 sm:px-6 md:px-12 lg:px-16 pt-8 sm:pt-10 pb-28 lg:pb-24 flex flex-col gap-6 sm:gap-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold max-w-2xl">
            This is REItools — the tools built to complement your REIblast system.
          </h1>
          <p className="text-gray text-sm mt-2 max-w-2xl">Add anything you'd like to go over on your onboarding call.</p>
        </div>

        <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:gap-4.5 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {cards.map((card) => (
                <ProductCard key={card.key} card={card} onLearnMore={() => handleLearnMore(card)} />
              ))}
            </div>

            <p className="text-[12.5px] text-gray">Don't know yet? No worries — find REItools inside your CRM.</p>
          </div>

          {/* Desktop — fixed sidebar */}
          <div className="hidden lg:block">{sidebarPanel}</div>
        </div>
      </div>

      {/* Mobile — floating trigger + drawer/sheet instead of a fixed sidebar */}
      <button
        onClick={() => setListDrawerOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-gold text-black font-semibold text-sm px-5 py-3 shadow-lg"
      >
        Your list
        {list.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1.5 text-[11px] font-bold text-gold">
            {list.length}
          </span>
        )}
      </button>

      <Drawer open={listDrawerOpen} onClose={() => setListDrawerOpen(false)} side="right" className="w-full max-w-full sm:max-w-sm">
        {sidebarPanel}
      </Drawer>

      <LearnMoreModal subject={learnMoreSubject} catalog={displayCatalog} onClose={() => setLearnMoreSubject(null)} onAddToList={addToList} />

      <InfoModal
        open={infoModalOpen}
        onClose={() => setInfoModalOpen(false)}
        cookieIdentity={cookieIdentity}
        emailHint={emailHint}
        listCount={list.length}
        submitting={submitting}
        onSubmit={handleInfoSubmit}
      />

      {siteAddon && (
        <WebsiteInterstitial
          open={interstitialOpen}
          onClose={() => setInterstitialOpen(false)}
          onAddToList={() => addToList({ id: `service-${siteAddon.slug}`, kind: 'service', name: siteAddon.name, slug: siteAddon.slug })}
        />
      )}

      <ExitIntentModal open={exitIntentOpen} onClose={() => setExitIntentOpen(false)} />
    </main>
  )
}
