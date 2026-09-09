import React from 'react'

type TagTone = 'neutral' | 'gold' | 'green' | 'red'

interface TagProps {
  tone?: TagTone
  className?: string
  children: React.ReactNode
}

const toneClasses: Record<TagTone, string> = {
  neutral: 'bg-surface-2 text-silver border border-border-default',
  gold: 'bg-gold/10 text-gold border border-gold/30',
  green: 'bg-green/10 text-green border border-green/30',
  red: 'bg-red/10 text-red border border-red/30',
}

export default function Tag({ tone = 'neutral', className = '', children }: TagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
