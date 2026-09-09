import React from 'react'

interface CreditCoinProps {
  /** Formatted/display value — callers own number formatting (e.g. "1,240" or "∞"). */
  value: string | number
  size?: 'sm' | 'md'
  className?: string
}

const sizeClasses = {
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-6 w-6 text-xs',
}

export default function CreditCoin({ value, size = 'md', className = '' }: CreditCoinProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-flex items-center justify-center rounded-full bg-gold text-black font-bold ${sizeClasses[size]}`}
        aria-hidden="true"
      >
        $
      </span>
      <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
        {value}
      </span>
    </span>
  )
}
