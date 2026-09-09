'use client'

import Image from 'next/image'
import Link from 'next/link'
import Card from '@/components/shared/Card'
import Button from '@/components/shared/Button'
import StatusDot from '@/components/shared/StatusDot'
import CreditCoin from '@/components/shared/CreditCoin'
import Tag from '@/components/shared/Tag'
import { getBrandAssets } from '@/lib/brandAssets'
import { cardStatus, resolveAllowance } from '@/lib/pricing'
import { buildStoreLink } from '@/lib/storeLink'
import type { Bundle, Member, SoloPlan, Tool } from '@/types/catalog'

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

interface ToolCardProps {
  tool: Tool
  member: Member
  bundle: Bundle | null
  soloPlans: SoloPlan[]
  onKeepGoing: (tool: Tool) => void
}

export default function ToolCard({ tool, member, bundle, soloPlans, onKeepGoing }: ToolCardProps) {
  const status = cardStatus(tool, member, bundle, soloPlans)
  const assets = getBrandAssets(tool.slug)

  const isLiveGroup = status === 'in-plan' || status === 'free' || status === 'on-credits'
  const isGated = status === 'out-of-credits'
  const isComingSoon = status === 'coming-soon'
  const showGreenDot = isLiveGroup || isGated
  const bodyBlurred = isGated || isComingSoon

  let infoLine: React.ReactNode = null

  if (status === 'in-plan') {
    const { allowance } = resolveAllowance(tool, member, bundle, soloPlans)
    const used = member.entitlements.allowanceUsed[tool.slug] ?? 0
    const metered = allowance !== null && Number.isFinite(allowance)

    infoLine = metered ? (
      <div className="w-full">
        <div className="flex items-center justify-between text-[12.2px] text-silver mb-1.75">
          <span>
            {used} / {allowance} {tool.unit}s
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-black overflow-hidden">
          <div
            className="h-full rounded-full bg-gold"
            style={{ width: `${Math.min(100, (used / (allowance as number)) * 100)}%` }}
          />
        </div>
      </div>
    ) : (
      <Tag tone="gold">Unlimited with your plan</Tag>
    )
  } else if (status === 'free') {
    infoLine = <Tag tone="green">Free</Tag>
  } else if (status === 'on-credits' || status === 'out-of-credits') {
    const balance = member.entitlements.creditBalances[tool.slug] ?? 0
    infoLine = <CreditCoin value={`${balance} credits`} size="sm" />
  }

  const blurClasses = bodyBlurred ? 'blur-sm opacity-50 pointer-events-none select-none' : ''

  return (
    <Card className="relative flex flex-col rounded-[15px]! px-5! py-4.5! min-h-48.5 overflow-hidden">
      {/* status strip — never blurred, even when the body is gated/coming-soon */}
      <div className="flex items-center justify-between h-4 mb-3.5">
        {status === 'locked' ? (
          <StatusDot color="red" label="Not in your plan" />
        ) : isComingSoon ? (
          <span className="flex items-center gap-2 text-[11.5px] text-silver">
            <ClockIcon className="h-3.75 w-3.75" />
            Coming soon
          </span>
        ) : showGreenDot ? (
          <StatusDot color="green" pulse label="Live" />
        ) : (
          <span />
        )}
        {status === 'locked' && <LockIcon className="h-4 w-4 text-red" />}
      </div>

      <div className={`flex flex-col flex-1 ${blurClasses}`}>
        <Image
          src={assets.wordmark}
          alt={tool.name}
          height={26}
          width={140}
          className="mb-2.25"
          style={{ alignSelf: 'flex-start', height: 26, width: 'auto' }}
        />

        <p className="text-[12.9px] text-silver">{tool.tagline}</p>

        <div className="mt-3.75 min-h-8 flex flex-col justify-center">{infoLine}</div>

        <div className="mt-auto pt-4">
          {(isLiveGroup || isGated) && (
            <Link href={tool.href} tabIndex={isGated ? -1 : undefined}>
              <Button variant="gold" size="sm" className="w-full">
                Open
              </Button>
            </Link>
          )}

          {status === 'locked' && (
            <Link href={buildStoreLink({ from: tool.slug, intent: 'learn' })}>
              <Button variant="gold-outline" size="sm" className="w-full">
                Learn more
              </Button>
            </Link>
          )}

          {isComingSoon && (
            <Button variant="gold-outline" size="sm" className="w-full" disabled>
              Open
            </Button>
          )}
        </div>
      </div>

      {isGated && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center px-6">
          <p className="text-sm font-semibold">You're out of credits</p>
          <p className="text-[12.4px] text-silver max-w-57.5">
            Included uses are spent and your wallet is empty. Add credits or upgrade to keep going.
          </p>
          <Button variant="gold" size="sm" className="mt-2" onClick={() => onKeepGoing(tool)}>
            Keep going
          </Button>
        </div>
      )}
    </Card>
  )
}
