'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import { getBrandAssets, portalBrand } from '@/lib/brandAssets'
import { formatCents } from '@/lib/money'
import type { StoreAddonService, StoreBundle, StoreTool } from '@/types/store'
import type { CartItem, LearnMoreSubject } from './cartTypes'

interface Tier {
  id: string
  name: string
  line: string
  priceCents: number
  per: 'mo' | 'once'
  stripePriceId: string | null
}

interface LearnMoreModalProps {
  subject: LearnMoreSubject | null
  tools: StoreTool[]
  bundles: StoreBundle[]
  services: StoreAddonService[]
  membershipName: string
  onClose: () => void
  onAddToCart: (item: CartItem) => void
}

export default function LearnMoreModal({
  subject,
  tools,
  bundles,
  services,
  membershipName,
  onClose,
  onAddToCart,
}: LearnMoreModalProps) {
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)

  let wordmark = portalBrand.wordmark
  let name = ''
  let hook = ''
  let compareCopy: string[] = []
  let note = ''
  let tiers: Tier[] = []
  let subjectFeatureSlug: string | undefined

  if (subject?.kind === 'tool') {
    const tool = tools.find((t) => t.slug === subject.toolSlug)
    if (tool) {
      wordmark = getBrandAssets(tool.brandSlug).wordmark
      name = tool.name
      hook = tool.hook
      compareCopy = tool.compareCopy
      subjectFeatureSlug = tool.featureSlug
      // Base tier is membership-included (priceCents 0) for core_included features and
      // is never the thing being sold here — only paid rungs are purchasable add-ons.
      tiers = tool.tiers
        .filter((tier) => tier.priceCents > 0)
        .map((tier) => ({
          id: tier.id,
          name: tier.name,
          line: tier.allowance === null ? `Unlimited ${tool.unit} / mo` : `${tier.allowance} ${tool.unit} included / mo`,
          priceCents: tier.priceCents,
          per: 'mo',
          stripePriceId: tier.stripePriceId,
        }))
      note = 'Or get it inside a bundle with a higher shared allowance.'
    }
  } else if (subject?.kind === 'bundle') {
    const bundle = bundles.find((b) => b.slug === subject.bundleSlug)
    if (bundle) {
      name = bundle.name
      hook = bundle.tagline
      compareCopy = bundle.coverageLines
      tiers = [
        {
          id: bundle.id,
          name: `${bundle.name} bundle`,
          line: bundle.coverageLines[0] ?? '',
          priceCents: bundle.priceCents,
          per: 'mo',
          stripePriceId: bundle.stripePriceId,
        },
      ]
      note = `On top of your ${membershipName} membership. Replaces any lower bundle or solo subscriptions it covers.`
    }
  } else if (subject?.kind === 'service') {
    const service = services.find((s) => s.id === subject.serviceId)
    if (service) {
      wordmark = service.toolSlug ? getBrandAssets(service.toolSlug).wordmark : portalBrand.wordmark
      name = service.name
      hook = service.hook
      compareCopy = service.compareCopy
      // Op-direct services are config-only (no DB row, no Stripe Price) —
      // stripePriceId stays null, which blocks checkout on this item (see
      // CartDrawer). They sell via book-a-call, never inline checkout.
      tiers = [
        {
          id: service.id,
          name: service.name,
          line: service.compareCopy[0] ?? '',
          priceCents: service.priceCents,
          per: 'once',
          stripePriceId: null,
        },
      ]
      note = 'Distributed by OP Web Studio.'
    }
  }

  const activeTierId = selectedTierId ?? tiers[0]?.id ?? null

  useEffect(() => {
    setSelectedTierId(tiers[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject])

  const handleAdd = () => {
    const tier = tiers.find((t) => t.id === activeTierId)
    if (!tier || !subject) return

    const item: CartItem = {
      id: tier.id,
      kind: tier.per === 'once' ? 'once' : 'sub',
      name: tier.name,
      priceCents: tier.priceCents,
      stripePriceId: tier.stripePriceId,
      featureSlug: subject.kind === 'tool' ? subjectFeatureSlug : undefined,
      bundleSlug: subject.kind === 'bundle' ? subject.bundleSlug : undefined,
    }
    onAddToCart(item)
    onClose()
  }

  return (
    <Modal open={!!subject} onClose={onClose} className="max-w-xl!">
      {subject && (
        <>
          <div className="flex items-start justify-between gap-4 mb-4">
            <Image src={wordmark} alt={name} height={30} width={160} style={{ height: 30, width: 'auto' }} />
            <button onClick={onClose} aria-label="Close" className="text-gray hover:text-white text-2xl leading-none px-1.5">
              ×
            </button>
          </div>

          <p className="text-[15px] leading-relaxed">{hook}</p>
          {compareCopy.length > 0 && <p className="text-[12.8px] text-silver mt-2">{compareCopy.join(' · ')}</p>}

          <div className="flex flex-col gap-2.5 mt-5">
            {tiers.map((tier) => {
              const selected = tier.id === activeTierId
              return (
                <button
                  key={tier.id}
                  onClick={() => setSelectedTierId(tier.id)}
                  className={`flex items-center gap-4 rounded-xl border px-4 py-3.75 text-left transition-colors ${
                    selected ? 'border-gold shadow-[inset_0_0_0_1px_var(--color-gold)]' : 'border-border-default hover:border-gold-hover'
                  } bg-black`}
                >
                  <div className="flex-1">
                    <div className="font-semibold text-[14.5px] font-display">{tier.name}</div>
                    <div className="text-[12.4px] text-silver mt-0.5">{tier.line}</div>
                  </div>
                  <div className="font-bold text-lg font-display whitespace-nowrap">
                    {tier.per === 'once' ? formatCents(tier.priceCents) : `+${formatCents(tier.priceCents)}`}
                    <span className="text-[11.5px] font-medium text-silver"> {tier.per === 'once' ? 'one-time' : '/mo'}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {note && <p className="text-[11.8px] text-gray mt-2">{note}</p>}

          <div className="flex gap-2.5 mt-5">
            <Button variant="gold-outline" size="sm" className="flex-1" onClick={onClose}>
              Not now
            </Button>
            <Button variant="gold" size="sm" className="flex-1" onClick={handleAdd} disabled={!activeTierId}>
              Add to cart
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
