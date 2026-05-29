'use client'

import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  prefixIcon?: React.ReactNode
}

export default function Input({
  label,
  error,
  prefixIcon,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-white/80">
          {label}
        </label>
      )}
      <div className="relative">
        {prefixIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
            {prefixIcon}
          </div>
        )}
        <input
          id={inputId}
          className={`
            w-full bg-surface-2 text-white rounded-lg border
            ${error ? 'border-red-500' : 'border-white/10 focus:border-gold'}
            ${prefixIcon ? 'pl-10' : 'pl-4'} pr-4 py-3
            outline-none transition-colors duration-150 placeholder:text-white/30
            ${className}
          `}
          {...props}
        />
      </div>
      {error && <p className="text-red-400 text-xs mt-0.5">{error}</p>}
    </div>
  )
}
