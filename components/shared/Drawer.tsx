'use client'

import React, { useEffect } from 'react'

type DrawerSide = 'left' | 'right'

interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: DrawerSide
  className?: string
  children: React.ReactNode
}

const sideClasses: Record<DrawerSide, string> = {
  left: 'left-0 border-r',
  right: 'right-0 border-l',
}

/** Empty, composable drawer shell sliding in from a side. No header/footer/copy baked in. */
export default function Drawer({ open, onClose, side = 'right', className = '', children }: DrawerProps) {
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
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute top-0 h-full w-full max-w-sm border-border-default bg-surface p-6 animate-fade-rise overflow-y-auto ${sideClasses[side]} ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
