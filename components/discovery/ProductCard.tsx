import Image from 'next/image'
import Button from '@/components/shared/Button'
import Tag from '@/components/shared/Tag'
import type { DiscoveryStatus } from '@/types/discovery'

export interface DiscoveryCardData {
  key: string
  wordmark: string
  name: string
  blurb: string
  status: DiscoveryStatus
}

interface ProductCardProps {
  card: DiscoveryCardData
  onLearnMore: () => void
}

/**
 * Roadmap-everything, ALL LABEL, NO BLUR — discovery sells the roadmap by
 * labeling it clearly, not obscuring it (blur is a launcher treatment for a
 * gated card; there is no gate here, just a "coming soon" fact). "Learn more"
 * (and "Add to list" inside its modal) works identically regardless of status
 * — coming-soon is still interest-flaggable for the call.
 */
export default function ProductCard({ card, onLearnMore }: ProductCardProps) {
  const isComingSoon = card.status === 'coming-soon'

  return (
    <div className="relative flex flex-col rounded-[15px] border border-border-default bg-surface px-5 py-4.5 min-h-40">
      {isComingSoon && (
        <div className="mb-2.5">
          <Tag tone="neutral">Coming soon</Tag>
        </div>
      )}
      <Image
        src={card.wordmark}
        alt={card.name}
        height={24}
        width={130}
        className="mb-2.25"
        style={{ alignSelf: 'flex-start', height: 24, width: 'auto' }}
      />
      <p className="text-[12.7px] text-silver">{card.blurb}</p>
      <div className="mt-auto pt-3.75">
        <Button variant="gold-outline" size="sm" className="w-full" onClick={onLearnMore}>
          Learn more
        </Button>
      </div>
    </div>
  )
}
