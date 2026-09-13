import Link from 'next/link'
import Card from '@/components/shared/Card'
import Button from '@/components/shared/Button'
import { buildStoreLink } from '@/lib/storeLink'
import type { AccountMember, AccountMeteredFeature } from '@/types/account'

function formatPeriodEnd(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface WalletZoneProps {
  member: AccountMember
  meteredFeatures: AccountMeteredFeature[]
}

/** ZONE 1 — top-line: wallet balance hero + per-metered-feature allowance readouts. Read-only. */
export default function WalletZone({ member, meteredFeatures }: WalletZoneProps) {
  return (
    <Card variant="highlight" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-silver">Wallet balance</span>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center rounded-full bg-gold text-black font-bold h-9 w-9 text-base">
              $
            </span>
            <span className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
              {member.walletBalance}
            </span>
            <span className="text-sm text-silver">credits</span>
          </div>
        </div>
        <Link href={buildStoreLink({ from: 'account', intent: 'credits' })}>
          <Button variant="gold" size="md">
            Get credits
          </Button>
        </Link>
      </div>

      {meteredFeatures.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border-default pt-5">
          {meteredFeatures.map((feature) => (
            <div key={feature.featureSlug} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {feature.toolName}: {feature.used} of {feature.allowance} {feature.unit} included
                </span>
                <span className="text-xs text-silver">resets {formatPeriodEnd(feature.periodEnd)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-black overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${Math.min(100, (feature.used / feature.allowance) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
