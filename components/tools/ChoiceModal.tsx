'use client'

import Link from 'next/link'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import { buildStoreLink } from '@/lib/storeLink'
import type { LauncherTool } from '@/types/launcher'

interface ChoiceModalProps {
  open: boolean
  onClose: () => void
  tool: LauncherTool
}

/**
 * Explain-only — no transactions, no packs, no checkout here. Both options hand
 * off to the store with the tool + intent baked into the URL (lib/storeLink.ts).
 * The upgrade option only appears when tool.hasHigherTier is true — a bundle
 * only lowers price at the same allowance, so it's never offered here as a
 * substitute for a real higher tier, and there's nothing honest to offer at
 * all when no higher tier exists (bots/pack/ask at launch).
 */
export default function ChoiceModal({ open, onClose, tool }: ChoiceModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold mb-1">Keep going with {tool.name}</h2>
      <p className="text-sm text-silver mb-6">
        You're out of credits for {tool.name}. Add more credits{tool.hasHigherTier ? ', or move up a tier so this happens less.' : '.'}
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

        {tool.hasHigherTier && (
          <div className="rounded-lg border border-border-default p-4">
            <h3 className="text-sm font-semibold mb-1">Move up a tier</h3>
            <p className="text-sm text-silver mb-3">
              Get more included {tool.unit} every month, so this doesn't happen again.
            </p>
            <Link href={buildStoreLink({ from: tool.slug, intent: 'upgrade' })}>
              <Button variant="gold-outline" size="sm">
                Upgrade
              </Button>
            </Link>
          </div>
        )}
      </div>
    </Modal>
  )
}
