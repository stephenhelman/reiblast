'use client'

import Image from 'next/image'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import Tag from '@/components/shared/Tag'
import { getBrandAssets, portalBrand } from '@/lib/brandAssets'
import { formatCents } from '@/lib/money'
import type { DiscoveryCatalog, DiscoveryListItem, DiscoveryTool } from '@/types/discovery'

export type DiscoveryLearnMoreSubject =
  | { kind: 'tool'; toolSlug: string }
  | { kind: 'bundling' }
  | { kind: 'service'; serviceId: string }

interface LearnMoreModalProps {
  subject: DiscoveryLearnMoreSubject | null
  catalog: DiscoveryCatalog
  onClose: () => void
  onAddToList: (item: DiscoveryListItem) => void
}

/**
 * The PRICE LINE RULE — one restrained line, never a table:
 *   coming-soon              -> no price at all, just the pitch.
 *   active + core_included   -> "Included with your REIblast membership"
 *                                (+ "More options available" iff hasHigherTier).
 *   active + addon           -> the BASE tier price ONLY (never plus/pro —
 *                                anchoring risk) (+ "More options available"
 *                                iff hasHigherTier).
 */
function toolPriceLine(tool: DiscoveryTool): string | null {
  if (tool.status === 'coming-soon') return null

  const base = tool.bucket === 'core_included' ? 'Included with your REIblast membership' : formatCents(tool.basePriceCents)
  return tool.hasHigherTier ? `${base} · More options available` : base
}

const BUNDLING_LIST_ITEM: DiscoveryListItem = { id: 'bundling', kind: 'bundling', name: 'REItools bundling', slug: 'bundling' }

export default function LearnMoreModal({ subject, catalog, onClose, onAddToList }: LearnMoreModalProps) {
  // ---- REItools bundling — its own layout: the tiers ARE the product story ----
  if (subject?.kind === 'bundling') {
    const { status, tiers } = catalog.bundling
    const comingSoon = status === 'coming-soon'

    return (
      <Modal open onClose={onClose} className="max-w-xl! max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <Image src={portalBrand.wordmark} alt="REItools" height={30} width={160} style={{ height: 30, width: 'auto' }} />
          <button onClick={onClose} aria-label="Close" className="text-gray hover:text-white text-2xl leading-none px-1.5">
            ×
          </button>
        </div>

        {comingSoon && (
          <div className="mb-2.5">
            <Tag tone="neutral">Coming soon</Tag>
          </div>
        )}

        <p className="text-[15px] leading-relaxed">
          {comingSoon
            ? 'Bundle your tools — get more for less than buying each separately.'
            : 'Save by bundling — get more of your tools for less than buying each separately.'}
        </p>

        <p className="text-[12.8px] text-silver mt-3">REItools base — included with your REIblast membership.</p>

        {!comingSoon && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            {tiers.map((tier) => (
              <div key={tier.level} className="rounded-lg border border-border-default bg-black px-3.5 py-3.25">
                <div className="font-semibold text-[13.5px] font-display mb-2">{tier.name}</div>
                <ul className="flex flex-col gap-1">
                  {tier.includedToolNames.map((toolName) => (
                    <li key={toolName} className="text-[12.4px] text-silver">
                      {toolName}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2.5 mt-5">
          <Button variant="gold-outline" size="sm" className="flex-1" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="gold"
            size="sm"
            className="flex-1"
            onClick={() => {
              onAddToList(BUNDLING_LIST_ITEM)
              onClose()
            }}
          >
            Add to list
          </Button>
        </div>
      </Modal>
    )
  }

  // ---- Tool / service — the generic layout ----
  let wordmark = portalBrand.wordmark
  let name = ''
  let hook = ''
  let compareCopy: string[] = []
  let priceLine: string | null = null
  let comingSoon = false
  let listItem: DiscoveryListItem | null = null

  if (subject?.kind === 'tool') {
    const tool = catalog.tools.find((t) => t.slug === subject.toolSlug)
    if (tool) {
      wordmark = getBrandAssets(tool.brandSlug).wordmark
      name = tool.name
      hook = tool.hook
      compareCopy = tool.compareCopy
      priceLine = toolPriceLine(tool)
      comingSoon = tool.status === 'coming-soon'
      listItem = { id: `tool-${tool.slug}`, kind: 'tool', name: tool.name, slug: tool.slug }
    }
  } else if (subject?.kind === 'service') {
    const service = catalog.addons.find((s) => s.id === subject.serviceId)
    if (service) {
      wordmark = service.toolSlug ? getBrandAssets(service.toolSlug).wordmark : portalBrand.wordmark
      name = service.name
      hook = service.hook
      compareCopy = service.compareCopy
      priceLine = formatCents(service.priceCents) + ' one-time'
      listItem = { id: `service-${service.slug}`, kind: 'service', name: service.name, slug: service.slug }
    }
  }

  return (
    <Modal open={!!subject} onClose={onClose} className="max-w-xl! max-h-[85vh] overflow-y-auto">
      {subject && (
        <>
          <div className="flex items-start justify-between gap-4 mb-4">
            <Image src={wordmark} alt={name} height={30} width={160} style={{ height: 30, width: 'auto' }} />
            <button onClick={onClose} aria-label="Close" className="text-gray hover:text-white text-2xl leading-none px-1.5">
              ×
            </button>
          </div>

          {comingSoon && (
            <div className="mb-2.5">
              <Tag tone="neutral">Coming soon</Tag>
            </div>
          )}

          <p className="text-[15px] leading-relaxed">{hook}</p>
          {compareCopy.length > 0 && <p className="text-[12.8px] text-silver mt-2">{compareCopy.join(' · ')}</p>}

          {priceLine && <p className="text-[13.5px] font-semibold mt-4">{priceLine}</p>}

          <div className="flex gap-2.5 mt-5">
            <Button variant="gold-outline" size="sm" className="flex-1" onClick={onClose}>
              Not now
            </Button>
            <Button
              variant="gold"
              size="sm"
              className="flex-1"
              disabled={!listItem}
              onClick={() => {
                if (listItem) onAddToList(listItem)
                onClose()
              }}
            >
              Add to list
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
