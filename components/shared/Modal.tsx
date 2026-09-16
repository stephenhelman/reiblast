'use client'

import React, { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  className?: string
  children: React.ReactNode
}

/** Empty, composable modal shell — centered panel over a scrim. No header/footer/copy baked in. */
export default function Modal({ open, onClose, className = '', children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full max-w-lg rounded-xl border border-border-default bg-surface p-6 animate-fade-rise ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
