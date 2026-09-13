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
import type { AccountData } from '@/types/account'

interface AccountClientProps {
  account: AccountData
}

export default function AccountClient({ account }: AccountClientProps) {
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

        <WalletZone member={account.member} meteredFeatures={account.meteredFeatures} />
        <SubscriptionsZone subscriptions={account.subscriptions} />
        <LedgerZone ledger={account.ledger} />
      </div>
    </main>
  )
}
