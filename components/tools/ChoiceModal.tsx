'use client'

import Link from 'next/link'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import { buildStoreLink } from '@/lib/storeLink'
import type { Tool } from '@/types/catalog'

interface ChoiceModalProps {
  open: boolean
  onClose: () => void
  tool: Tool
}

/**
 * Explain-only — no transactions, no packs, no checkout here. Both options hand
 * off to the store with the tool + intent baked into the URL (lib/storeLink.ts).
 */
export default function ChoiceModal({ open, onClose, tool }: ChoiceModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold mb-1">Keep going with {tool.name}</h2>
      <p className="text-sm text-silver mb-6">
        You're out of credits for {tool.name}. Add more credits, or move to a plan that
        includes it going forward.
      </p>

      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-border-default p-4">
          <h3 className="text-sm font-semibold mb-1">Buy credits</h3>
          <p className="text-sm text-silver mb-3">
            Top up {tool.name} credits and keep going right away.
          </p>
          <Link href={buildStoreLink({ from: tool.slug, intent: 'credits' })}>
            <Button variant="gold" size="sm">
              Buy credits
            </Button>
          </Link>
        </div>

        <div className="rounded-lg border border-border-default p-4">
          <h3 className="text-sm font-semibold mb-1">Upgrade</h3>
          <p className="text-sm text-silver mb-3">
            Move to a plan that includes {tool.name}, so this doesn't happen again.
          </p>
          <Link href={buildStoreLink({ from: tool.slug, intent: 'upgrade' })}>
            <Button variant="gold-outline" size="sm">
              Upgrade
            </Button>
          </Link>
        </div>
      </div>
    </Modal>
  )
}
