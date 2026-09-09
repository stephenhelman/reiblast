import React from 'react'

export type StatusDotColor = 'green' | 'gold' | 'red'

interface StatusDotProps {
  color: StatusDotColor
  pulse?: boolean
  className?: string
  label?: string
}

const colorClasses: Record<StatusDotColor, string> = {
  green: 'bg-green',
  gold: 'bg-gold',
  red: 'bg-red',
}

export default function StatusDot({ color, pulse = false, className = '', label }: StatusDotProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative inline-flex h-2 w-2">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${colorClasses[color]} opacity-60 motion-safe:animate-ping motion-reduce:hidden`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${colorClasses[color]}`} />
      </span>
      {label && <span className="text-sm text-silver">{label}</span>}
    </span>
  )
}
