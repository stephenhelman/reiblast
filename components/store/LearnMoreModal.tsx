'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import { getBrandAssets, portalBrand } from '@/lib/brandAssets'
import type { Bundle, OpDirectService, SoloPlan, Tool } from '@/types/catalog'
import type { CartItem, LearnMoreSubject } from './cartTypes'

interface Tier {
  id: string
  name: string
  line: string
  price: number
  per: 'mo' | 'once'
}

interface LearnMoreModalProps {
  subject: LearnMoreSubject | null
  tools: Tool[]
  bundles: Bundle[]
  services: OpDirectService[]
  soloPlans: SoloPlan[]
  membershipName: string
  onClose: () => void
  onAddToCart: (item: CartItem) => void
}

export default function LearnMoreModal({
  subject,
  tools,
  bundles,
  services,
  soloPlans,
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

  if (subject?.kind === 'tool') {
    const tool = tools.find((t) => t.slug === subject.toolSlug)
    if (tool) {
      wordmark = getBrandAssets(tool.slug).wordmark
      name = tool.name
      hook = tool.hook
      compareCopy = tool.compareCopy
      const key = tool.entitlementGroup ?? tool.slug
      tiers = soloPlans
        .filter((sp) => sp.entitlementKey === key)
        .map((sp) => ({ id: sp.id, name: sp.name, line: `${sp.allowance} ${tool.unit}s included / mo`, price: sp.price, per: 'mo' }))
      note = 'Or get it inside a bundle with a higher shared allowance.'
    }
  } else if (subject?.kind === 'bundle') {
    const bundle = bundles.find((b) => b.slug === subject.bundleSlug)
    if (bundle) {
      const repTool = bundle.covers[0] ? tools.find((t) => t.slug === bundle.covers[0]) : undefined
      wordmark = repTool ? getBrandAssets(repTool.slug).wordmark : portalBrand.wordmark
      name = bundle.name
      hook = bundle.tagline
      compareCopy = bundle.compareCopy
      tiers = [{ id: bundle.id, name: `${bundle.name} bundle`, line: bundle.compareCopy[0] ?? '', price: bundle.price, per: 'mo' }]
      note = `On top of your ${membershipName} membership. Replaces any lower bundle or solo subscriptions it covers.`
    }
  } else if (subject?.kind === 'service') {
    const service = services.find((s) => s.id === subject.serviceId)
    if (service) {
      wordmark = service.toolSlug ? getBrandAssets(service.toolSlug).wordmark : portalBrand.wordmark
      name = service.name
      hook = service.hook
      compareCopy = service.compareCopy
      tiers = [{ id: service.id, name: service.name, line: service.compareCopy[0] ?? '', price: service.price, per: 'once' }]
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

    const toolForEntitlement = subject.kind === 'tool' ? tools.find((t) => t.slug === subject.toolSlug) : undefined
    const item: CartItem = {
      id: tier.id,
      kind: tier.per === 'once' ? 'once' : 'sub',
      name: tier.name,
      price: tier.price,
      entitlementKey: toolForEntitlement ? toolForEntitlement.entitlementGroup ?? toolForEntitlement.slug : undefined,
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
                    {tier.per === 'once' ? `$${tier.price}` : `+$${tier.price}`}
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
