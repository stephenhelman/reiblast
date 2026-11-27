'use client'

import React, { useEffect, useRef } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  className?: string
  /** id of the element that titles the dialog. */
  labelledBy?: string
  children: React.ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

/** Empty, composable modal shell — centered panel over a scrim. No header/footer/copy baked in. */
export default function Modal({ open, onClose, className = '', labelledBy, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Held in a ref so an inline onClose doesn't re-run the effect below and yank focus around mid-dialog.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    // Note: key presses inside a cross-origin iframe never reach this window.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', handleKey)

    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [open])

  if (!open) return null

  // Focus trap: tabbing past either end lands on a sentinel, which wraps to the other end. Unlike a Tab keydown
  // handler, this also works when focus is leaving an iframe.
  const wrapFocus = (to: 'first' | 'last') => {
    const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    const target = items?.[to === 'first' ? 0 : items.length - 1]
    ;(target ?? panelRef.current)?.focus()
  }

  return (
    // z-index sits above the chat widget (2147483000), which would otherwise cover the dialog.
    <div className="fixed inset-0 z-[2147483600] flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <span tabIndex={0} onFocus={() => wrapFocus('last')} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative w-full max-w-lg rounded-xl border border-border-default bg-surface p-6 outline-none animate-fade-rise ${className}`}
      >
        {children}
      </div>
      <span tabIndex={0} onFocus={() => wrapFocus('first')} />
    </div>
  )
}
