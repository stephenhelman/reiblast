'use client'

import Image from 'next/image'
import Link from 'next/link'
import AppHeader from '@/components/shared/AppHeader'
import Button from '@/components/shared/Button'
import { portalBrand } from '@/lib/brandAssets'
import { buildStoreLink } from '@/lib/storeLink'
import WalletZone from '@/components/account/WalletZone'
import SubscriptionsZone from '@/components/account/SubscriptionsZone'
import LedgerZone from '@/components/account/LedgerZone'
import ReviewZone from '@/components/account/ReviewZone'
import type { AccountData } from '@/types/account'
import type { ReviewItem } from '@/lib/reviewFeed'

interface AccountClientProps {
  account: AccountData
  /** Phase 4 — open admin proposals awaiting this member (getOpenChangesForMember). */
  openChanges: ReviewItem[]
}

export default function AccountClient({ account, openChanges }: AccountClientProps) {
  return (
    <main className="min-h-screen bg-black text-white">
      <AppHeader
        brandSlot={
          <Image
            src={portalBrand.wordmark}
            alt="REI/tools"
            height={30}
            width={140}
            style={{ height: 30, width: 'auto' }}
          />
        }
        account={{ name: account.member.name, creditBalance: account.member.walletBalance }}
        actionSlot={
          <Link href={buildStoreLink({ from: 'account', intent: 'credits' })}>
            <Button variant="gold" size="sm">
              Get credits
            </Button>
          </Link>
        }
      />

      <div className="max-w-310 w-full mx-auto px-6 md:px-12 lg:px-16 pt-10 pb-24 flex flex-col gap-8">
        <div>
          <h1 className="text-2xl font-semibold">Account &amp; wallet</h1>
          <p className="text-gray text-sm mt-1.25">Your balance, plans, and transaction history.</p>
        </div>

        <ReviewZone items={openChanges} />
        <WalletZone member={account.member} meteredFeatures={account.meteredFeatures} />
        <SubscriptionsZone subscriptions={account.subscriptions} currentBundleSlug={account.currentBundleSlug} />
        <LedgerZone ledger={account.ledger} />
      </div>
    </main>
  )
}
