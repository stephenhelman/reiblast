import React from 'react'

type CardVariant = 'default' | 'highlight' | 'dark'

interface CardProps {
  variant?: CardVariant
  className?: string
  children: React.ReactNode
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-surface border border-border-default',
  highlight: 'bg-surface border border-gold',
  dark: 'bg-black border border-gold',
}

export default function Card({ variant = 'default', className = '', children }: CardProps) {
  return (
    <div className={`rounded-xl p-6 ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  )
}
