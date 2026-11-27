'use client'

import { useEffect, useId, useState } from 'react'
import Modal from '@/components/shared/Modal'
import Button from '@/components/shared/Button'
import { ONBOARDING_BOOKING_URL, ONBOARDING_CALENDAR_ID } from '@/lib/constants'

const EMBED_SCRIPT_SRC = 'https://link.msgsndr.com/js/form_embed.js'

/**
 * Instead of embedding the calendar inline on the page, the call-to-action
 * opens the embed in a large modal — matches the standard pattern for GHL
 * embeds.
 */
export default function BookingModal() {
  // When the modal was opened (null = closed). Also the suffix of the iframe id, in GHL's {calendarId}_{timestamp} form.
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  const titleId = useId()
  const close = () => setOpenedAt(null)

  // form_embed.js only auto-resizes the iframes present when it runs, so it is run again on every open. next/script
  // would load it once per page: a reopened calendar (or any calendar, if the Ari video had already loaded the
  // script) would then never be resized.
  useEffect(() => {
    if (openedAt === null) return
    const script = document.createElement('script')
    script.src = EMBED_SCRIPT_SRC
    document.body.appendChild(script)
    return () => script.remove()
  }, [openedAt])

  return (
    <>
      <Button variant="primary" size="lg" className="w-full sm:w-auto sm:px-12" onClick={() => setOpenedAt(Date.now())}>
        Book Your Onboarding Call
      </Button>

      <Modal
        open={openedAt !== null}
        onClose={close}
        labelledBy={titleId}
        className="max-w-3xl! max-h-full flex flex-col p-3! sm:p-6!"
      >
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 id={titleId} className="text-white text-lg font-semibold">Book Your Onboarding Call</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="shrink-0 h-11 w-11 flex items-center justify-center text-gray hover:text-white text-2xl leading-none cursor-pointer"
          >
            ×
          </button>
        </div>

        {/* The one scroll area: form_embed.js grows the iframe to its content height, and this box scrolls it. */}
        <div className="min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-border-default bg-black">
          <iframe
            src={ONBOARDING_BOOKING_URL}
            title="Onboarding call calendar"
            className="w-full border-0 block"
            style={{ height: 700 }}
            id={`${ONBOARDING_CALENDAR_ID}_${openedAt}`}
          />
        </div>
      </Modal>
    </>
  )
}
