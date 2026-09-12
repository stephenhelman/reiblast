'use client'

import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'

interface WebsiteInterstitialProps {
  open: boolean
  onClose: () => void
  onAddToList: () => void
}

/** Once-per-session (session-gating lives in DiscoveryClient) — basic-vs-serious framing for the custom website. */
export default function WebsiteInterstitial({ open, onClose, onAddToList }: WebsiteInterstitialProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold mb-2">A basic site gets ignored. A serious one gets calls.</h2>
      <p className="text-sm text-silver leading-relaxed">
        REI/site is a conversion-built website wired straight into your CRM, done for you start to finish —
        the difference between a placeholder page and a site that actually books you deals.
      </p>
      <div className="flex gap-2.5 mt-5">
        <Button variant="gold-outline" size="sm" className="flex-1" onClick={onClose}>
          Not now
        </Button>
        <Button
          variant="gold"
          size="sm"
          className="flex-1"
          onClick={() => {
            onAddToList()
            onClose()
          }}
        >
          Add website to list
        </Button>
      </div>
    </Modal>
  )
}
