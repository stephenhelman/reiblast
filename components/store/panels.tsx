'use client'

import { useState } from 'react'
import Image from 'next/image'
import Button from '@/components/shared/Button'
import Tag from '@/components/shared/Tag'
import StatusDot from '@/components/shared/StatusDot'
import { getBrandAssets } from '@/lib/brandAssets'
import { cardStatus, packToUnits } from '@/lib/pricing'
import type { Bundle, BundleSlug, Member, OpDirectService, Pack, SoloPlan, Tool } from '@/types/catalog'
import type { CartItem, LearnMoreSubject } from './cartTypes'

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ============ CREDITS ============ */

interface CreditsPanelProps {
  tools: Tool[]
  packs: Pack[]
  initialToolSlug?: Tool['slug']
  onAddToCart: (item: CartItem) => void
}

export function CreditsPanel({ tools, packs, initialToolSlug, onAddToCart }: CreditsPanelProps) {
  // Packs are universal now — the chips just pick which tool's units a pack's
  // credits get translated into, they don't filter which packs are shown.
  const meteredTools = tools.filter((t) => t.consumesCredits)
  const [selectedSlug, setSelectedSlug] = useState(
    initialToolSlug && meteredTools.some((t) => t.slug === initialToolSlug) ? initialToolSlug : meteredTools[0]?.slug,
  )

  const selectedTool = meteredTools.find((t) => t.slug === selectedSlug) ?? meteredTools[0]

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs text-silver mb-2.5">See what a pack is worth in:</div>
        <div className="flex gap-2 flex-wrap">
          {meteredTools.map((tool) => {
            const assets = getBrandAssets(tool.slug)
            const on = tool.slug === selectedTool?.slug
            return (
              <button
                key={tool.slug}
                onClick={() => setSelectedSlug(tool.slug)}
                className={`inline-flex items-center gap-2 rounded-full px-3.25 py-1.75 text-sm border transition-colors ${
                  on
                    ? 'bg-gold/10 border-gold text-gold'
                    : 'bg-surface border-border-default text-silver hover:text-white hover:border-gray'
                }`}
              >
                <Image src={assets.iconPng} alt="" height={14} width={14} className={on ? '' : 'grayscale opacity-60'} />
                {tool.unit}s
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(4,1fr)] max-lg:grid-cols-2 max-sm:grid-cols-1">
        {packs.map((pack) => {
          const units = selectedTool ? packToUnits(pack, selectedTool) : 0
          return (
            <div
              key={pack.id}
              className={`relative flex flex-col gap-1 rounded-[15px] border bg-surface px-5 py-5.5 ${
                pack.bestValue ? 'border-gold-hover' : 'border-border-default'
              }`}
            >
              {pack.bestValue && (
                <span className="absolute -top-2.5 left-5 rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-black">
                  Best value
                </span>
              )}
              <div className="text-2xl font-semibold font-display">
                {pack.credits} <span className="text-xs font-normal text-silver">credits</span>
              </div>
              <div className="text-[15px] mt-0.5">${pack.price}</div>
              {selectedTool && (
                <div className="text-[12.5px] text-gold mt-0.5">
                  {units} {selectedTool.unit}
                  {units === 1 ? '' : 's'}
                </div>
              )}
              <Button
                variant={pack.bestValue ? 'gold' : 'gold-outline'}
                size="sm"
                className="mt-3.5"
                onClick={() => onAddToCart({ id: pack.id, kind: 'credits', name: pack.name, price: pack.price })}
              >
                Add to cart
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ============ TOOLS ============ */

interface ToolsPanelProps {
  tools: Tool[]
  member: Member
  bundle: Bundle | null
  soloPlans: SoloPlan[]
  onLearnMore: (subject: LearnMoreSubject) => void
}

export function ToolsPanel({ tools, member, bundle, soloPlans, onLearnMore }: ToolsPanelProps) {
  return (
    <div className="grid gap-4.5 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
      {tools.map((tool) => {
        const status = cardStatus(tool, member, bundle, soloPlans)
        const assets = getBrandAssets(tool.slug)

        let pill: React.ReactNode
        let footer: React.ReactNode

        if (status === 'in-plan') {
          pill = (
            <span className="inline-flex items-center gap-1.5 text-green text-[12.5px]">
              <CheckIcon className="h-3.5 w-3.5" /> In your plan
            </span>
          )
          footer = (
            <Button variant="quiet" size="sm" className="w-full" disabled>
              In your plan
            </Button>
          )
        } else if (status === 'free') {
          pill = (
            <span className="inline-flex items-center gap-1.5 text-gold text-[12.5px]">
              <CheckIcon className="h-3.5 w-3.5" /> Included free with every plan
            </span>
          )
          footer = (
            <Button variant="quiet" size="sm" className="w-full" disabled>
              Included
            </Button>
          )
        } else if (status === 'coming-soon') {
          pill = (
            <span className="inline-flex items-center gap-1.5 text-gray text-[12.5px]">
              <ClockIcon className="h-3.5 w-3.5" /> Coming soon
            </span>
          )
          footer = (
            <Button variant="quiet" size="sm" className="w-full" disabled>
              Notify me
            </Button>
          )
        } else {
          pill = <StatusDot color="gold" label="Available to add" />
          footer = (
            <Button variant="gold-outline" size="sm" className="w-full" onClick={() => onLearnMore({ kind: 'tool', toolSlug: tool.slug })}>
              Learn more
            </Button>
          )
        }

        return (
          <div key={tool.slug} className="flex flex-col rounded-[15px] border border-border-default bg-surface px-5 py-4.5 min-h-43">
            <Image
              src={assets.wordmark}
              alt={tool.name}
              height={24}
              width={130}
              className="mb-2.25"
              style={{ alignSelf: 'flex-start', height: 24, width: 'auto' }}
            />
            <p className="text-[12.7px] text-silver">{tool.tagline}</p>
            <div className="mt-3.5">{pill}</div>
            <div className="mt-auto pt-3.75">{footer}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ============ BUNDLES ============ */

interface BundlesPanelProps {
  /** The non-purchasable Core reference baseline — always rendered first, never a CTA. */
  coreBaseline: Bundle
  /** Purchasable bundles only (Plus/Pro). */
  bundles: Bundle[]
  membershipName: string
  membershipPrice: number
  currentBundleSlug: BundleSlug | null
  onLearnMore: (subject: LearnMoreSubject) => void
}

function BundleCard({
  bundle,
  membershipName,
  membershipPrice,
  isCore,
  isCurrent,
  onLearnMore,
}: {
  bundle: Bundle
  membershipName: string
  membershipPrice: number
  isCore: boolean
  isCurrent: boolean
  onLearnMore: (subject: LearnMoreSubject) => void
}) {
  return (
    <div
      className={`relative flex flex-col rounded-[15px] border bg-surface px-5.5 py-6 ${
        isCurrent || isCore ? 'border-green' : bundle.bestValue ? 'border-gold-hover' : 'border-border-default'
      }`}
    >
      {(isCurrent || isCore) && (
        <span className="absolute -top-2.5 left-5.5 rounded-full bg-green px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-black">
          Your membership
        </span>
      )}
      {!isCore && !isCurrent && bundle.bestValue && (
        <span className="absolute -top-2.5 left-5.5 rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-black">
          Best value
        </span>
      )}

      <div className="text-lg font-semibold font-display">{bundle.name}</div>
      <div className="text-3xl font-bold font-display mt-2.5">
        {isCore ? '+$0' : `+$${bundle.price}`}
        <span className="text-[13px] font-medium text-silver">/mo</span>
      </div>
      <div className="text-[11.8px] text-gray mt-1.25">
        {isCore
          ? `included with your $${membershipPrice}/mo ${membershipName} membership`
          : `on top of your $${membershipPrice}/mo ${membershipName} membership`}
      </div>
      <div className="text-[12.7px] text-silver mt-2">{bundle.tagline}</div>

      <ul className="flex flex-col gap-2.25 my-4">
        {bundle.compareCopy.map((line) => (
          <li key={line} className="flex items-start gap-2.25 text-sm">
            <CheckIcon className="h-3.75 w-3.75 text-gold mt-0.5 shrink-0" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-auto">
        {isCore ? (
          <Button variant="quiet" size="sm" className="w-full" disabled>
            Included — not purchasable
          </Button>
        ) : isCurrent ? (
          <Button variant="quiet" size="sm" className="w-full" disabled>
            Your current plan
          </Button>
        ) : (
          <Button
            variant={bundle.bestValue ? 'gold' : 'gold-outline'}
            size="sm"
            className="w-full"
            onClick={() => onLearnMore({ kind: 'bundle', bundleSlug: bundle.slug })}
          >
            Learn more
          </Button>
        )}
      </div>
    </div>
  )
}

export function BundlesPanel({
  coreBaseline,
  bundles,
  membershipName,
  membershipPrice,
  currentBundleSlug,
  onLearnMore,
}: BundlesPanelProps) {
  return (
    <div className="grid gap-4.5 grid-cols-3 max-lg:grid-cols-1">
      <BundleCard
        bundle={coreBaseline}
        membershipName={membershipName}
        membershipPrice={membershipPrice}
        isCore
        isCurrent={false}
        onLearnMore={onLearnMore}
      />
      {bundles.map((bundle) => (
        <BundleCard
          key={bundle.slug}
          bundle={bundle}
          membershipName={membershipName}
          membershipPrice={membershipPrice}
          isCore={false}
          isCurrent={bundle.slug === currentBundleSlug}
          onLearnMore={onLearnMore}
        />
      ))}
    </div>
  )
}

/* ============ ADD-ONS ============ */

interface AddonsPanelProps {
  services: OpDirectService[]
  onLearnMore: (subject: LearnMoreSubject) => void
}

export function AddonsPanel({ services, onLearnMore }: AddonsPanelProps) {
  return (
    <div className="grid gap-4.5 grid-cols-2 max-md:grid-cols-1">
      {services.map((service) => {
        const assets = service.toolSlug ? getBrandAssets(service.toolSlug) : null
        return (
          <div key={service.id} className="flex flex-col rounded-[15px] border border-border-default bg-surface px-6 py-6.5">
            {assets && (
              <Image
                src={assets.wordmark}
                alt={service.name}
                height={28}
                width={150}
                className="mb-3"
                style={{ alignSelf: 'flex-start', height: 28, width: 'auto' }}
              />
            )}
            <p className="text-[13.5px] text-silver leading-relaxed">{service.hook}</p>
            <div className="text-xs text-gray mt-4">Distributed by OP Web Studio · one-time build</div>
            <div className="mt-auto pt-4.5">
              <Button variant="gold" size="sm" className="w-full" onClick={() => onLearnMore({ kind: 'service', serviceId: service.id })}>
                Learn more
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
