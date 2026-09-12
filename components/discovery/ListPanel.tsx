'use client'

import Button from '@/components/shared/Button'
import type { DiscoveryListItem } from '@/types/discovery'

interface ListPanelProps {
  list: DiscoveryListItem[]
  onRemove: (id: string) => void
  onReady: () => void
  submitting: boolean
  submitted: boolean
}

/**
 * Plain checklist — uncheck-able, NO totals, NO smart-cart, NO suggestions.
 * It's a call agenda, not a cart. State lives in sessionStorage (see
 * DiscoveryClient), which is the "clears on close" storage this needs —
 * closing the tab/browser session clears it for free, no extra logic here.
 *
 * "I'm ready" never hard-blocks on an empty list — a warm lead who just
 * wants to talk is valid — it just opens the info modal with a gentle nudge
 * instead of a wall.
 */
export default function ListPanel({ list, onRemove, onReady, submitting, submitted }: ListPanelProps) {
  if (submitted) {
    return (
      <div className="rounded-xl border border-green bg-surface px-5 py-6 text-center">
        <p className="text-base font-semibold">Thanks for the inquiry — see you on the onboarding call!</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border-default bg-surface px-5 py-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Your call agenda</h2>

      {list.length === 0 ? (
        <p className="text-[12.7px] text-silver">Nothing added yet — use "Learn more" on anything you want to go over.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked
                onChange={() => onRemove(item.id)}
                className="h-4 w-4 accent-gold"
                aria-label={`Remove ${item.name} from the list`}
              />
              <span>{item.name}</span>
            </li>
          ))}
        </ul>
      )}

      <Button variant="gold" size="sm" className="mt-2" disabled={submitting} onClick={onReady}>
        {submitting ? 'Sending...' : "I'm ready"}
      </Button>
      {list.length === 0 && (
        <p className="text-[11.5px] text-gray">That's okay too — you can still talk it over on your call.</p>
      )}
    </div>
  )
}
