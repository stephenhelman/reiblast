'use client'

import Drawer from '@/components/shared/Drawer'
import Button from '@/components/shared/Button'
import { smartCart } from '@/lib/pricing'
import type { Bundle } from '@/types/catalog'
import type { CartItem } from './cartTypes'

interface CartDrawerProps {
  open: boolean
  onClose: () => void
  cart: CartItem[]
  bundles: Bundle[]
  membershipName: string
  onRemove: (id: string) => void
  onApplySwap: (bundle: Bundle) => void
}

const KIND_LABEL: Record<CartItem['kind'], string> = {
  sub: 'Subscription',
  once: 'One-time',
  credits: 'Credit pack',
}

export default function CartDrawer({ open, onClose, cart, bundles, membershipName, onRemove, onApplySwap }: CartDrawerProps) {
  const smartCartCandidates = cart.filter(
    (item): item is CartItem & { entitlementKey: NonNullable<CartItem['entitlementKey']> } =>
      !!item.entitlementKey && !item.bundleSlug,
  )
  const suggestedBundle = smartCart(
    smartCartCandidates.map((item) => ({ entitlementKey: item.entitlementKey, price: item.price })),
    bundles,
  )
  const soloSum = suggestedBundle ? smartCartCandidates.reduce((sum, item) => sum + item.price, 0) : 0
  const savings = suggestedBundle ? soloSum - suggestedBundle.price : 0

  const monthly = cart.filter((i) => i.kind === 'sub').reduce((sum, i) => sum + i.price, 0)
  const oneTime = cart.filter((i) => i.kind !== 'sub').reduce((sum, i) => sum + i.price, 0)

  return (
    <Drawer open={open} onClose={onClose} side="right" className="flex! flex-col p-0! max-w-105!">
      <div className="flex items-center justify-between px-5.5 py-5 border-b border-border-default">
        <h2 className="text-lg font-semibold font-display">Your cart</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray hover:text-white text-2xl leading-none px-1.5">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-auto px-5.5 py-4 flex flex-col gap-3">
        {cart.length === 0 ? (
          <div className="text-gray text-sm text-center mt-10">Your cart is empty.</div>
        ) : (
          cart.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border-default bg-black px-3.5 py-3.25">
              <div>
                <div className="font-semibold text-[13.5px]">{item.name}</div>
                <div className="text-[11.8px] text-silver mt-0.5">{KIND_LABEL[item.kind]}</div>
              </div>
              <div className="ml-auto font-bold font-display text-sm whitespace-nowrap">
                {item.kind === 'sub' ? `+$${item.price}/mo` : `$${item.price}`}
              </div>
              <button onClick={() => onRemove(item.id)} className="text-gray hover:text-red text-base px-1">
                ×
              </button>
            </div>
          ))
        )}

        {suggestedBundle && savings > 0 && (
          <div className="rounded-xl border border-gold-hover bg-gold/10 px-3.75 py-3.5">
            <div className="flex items-center gap-2 font-semibold text-sm text-gold">Smart cart</div>
            <p className="text-[12.4px] mt-1.5 leading-relaxed">
              The <b className="text-white">{suggestedBundle.name}</b> bundle covers what you've added for less than buying it piece by
              piece.
            </p>
            <Button variant="gold" size="sm" className="w-full mt-2.5" onClick={() => onApplySwap(suggestedBundle)}>
              Swap to {suggestedBundle.name} · save ${savings}/mo
            </Button>
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="border-t border-border-default px-5.5 py-4.5">
          <div className="flex justify-between text-sm text-silver mb-1">
            <span>Monthly</span>
            <span>+${monthly}/mo</span>
          </div>
          <div className="flex justify-between text-sm text-silver mb-2">
            <span>One-time</span>
            <span>${oneTime}</span>
          </div>
          <div className="flex justify-between font-semibold text-base font-display mb-3.5">
            <span>Due today</span>
            <span>${monthly + oneTime}</span>
          </div>
          <p className="text-[11.5px] text-gray mb-3">Recurring items are billed on top of your {membershipName} membership.</p>
          <Button variant="gold" size="sm" className="w-full" disabled>
            Checkout (stubbed)
          </Button>
        </div>
      )}
    </Drawer>
  )
}
