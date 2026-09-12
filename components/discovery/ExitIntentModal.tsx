'use client'

import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'

interface ExitIntentModalProps {
  open: boolean
  onClose: () => void
}

/** Once per session, graceful — never blocks. A wave goodbye, not a gate. */
export default function ExitIntentModal({ open, onClose }: ExitIntentModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold mb-2">See you on your call!</h2>
      <p className="text-sm text-silver leading-relaxed">
        If you change your mind, look for REItools inside your REIblast system.
      </p>
      <Button variant="gold" size="sm" className="mt-5 w-full" onClick={onClose}>
        Okay
      </Button>
    </Modal>
  )
}
