'use client'

import { useState } from 'react'
import Script from 'next/script'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'

interface BookingModalProps {
  bookingSrc: string
}

/**
 * Instead of embedding the calendar inline on the page, the call-to-action
 * opens the embed in a large modal — matches the standard pattern for GHL
 * embeds.
 */
export default function BookingModal({ bookingSrc }: BookingModalProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="gold" size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Book Your Onboarding Call
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} className="max-w-3xl! w-[95vw] max-h-[95vh] overflow-y-auto scrollbar-hide">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-white text-lg font-semibold">Book Your Onboarding Call</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray hover:text-white text-2xl leading-none px-1.5">
            ×
          </button>
        </div>

        <div className="rounded-xl border border-border-default bg-black">
          <iframe
            src={bookingSrc}
            className="w-full border-0 block"
            style={{ height: 700 }}
            id="p2AFv4aWQvYZgAhOOxsg_1788397624766"
          />
        </div>

        {open && <Script src="https://link.msgsndr.com/js/form_embed.js" strategy="afterInteractive" />}
      </Modal>
    </>
  )
}
