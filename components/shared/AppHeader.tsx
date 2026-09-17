import React from 'react'
import CreditCoin from '@/components/shared/CreditCoin'
import TopNav, { type TopNavRole } from '@/components/shared/TopNav'

interface AccountBlockProps {
  name: string
  creditBalance?: string | number
}

/** Name + initials avatar row, stacked above a balance row (label, coin figure, inline action). */
function AccountBlock({ name, creditBalance, actionSlot }: AccountBlockProps & { actionSlot?: React.ReactNode }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex flex-col items-end gap-2.25">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold">{name}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 border border-border-default text-xs font-semibold text-silver">
          {initials || '?'}
        </span>
      </div>
      {(creditBalance !== undefined || actionSlot) && (
        <div className="flex items-center gap-2.75">
          {creditBalance !== undefined && (
            <>
              <span className="text-[11.5px] text-silver">Credit balance</span>
              <CreditCoin value={creditBalance} size="sm" />
            </>
          )}
          {actionSlot}
        </div>
      )}
    </div>
  )
}

interface AppHeaderProps {
  /** Brand slot — wordmark on the launcher, "Back to REI/tools" link on the store. Swappable per surface. */
  brandSlot: React.ReactNode
  account: AccountBlockProps
  /** Inline action next to the balance figure — e.g. "Get credits" or a cart trigger. Swappable per surface. */
  actionSlot?: React.ReactNode
  /** The member's role — when provided, renders the shared Tools|Store|Admin nav (components/shared/TopNav.tsx) next to the brand slot. Omit on surfaces that don't have a resolved member (e.g. pre-auth). */
  role?: TopNavRole
  className?: string
}

export default function AppHeader({ brandSlot, account, actionSlot, role, className = '' }: AppHeaderProps) {
  return (
    <header
      className={`flex items-center justify-between gap-6 border-b border-border-default bg-black px-6 md:px-12 lg:px-16 py-4.5 sticky top-0 z-20 backdrop-blur-md ${className}`}
    >
      <div className="flex items-center gap-6">
        {brandSlot}
        {role && <TopNav role={role} />}
      </div>
      <AccountBlock {...account} actionSlot={actionSlot} />
    </header>
  )
}
