'use client'

import { Logo } from '@/components/shared/Logo'

interface MinimalHeaderProps {
  title: string
}

export default function MinimalHeader({ title }: MinimalHeaderProps) {
  return (
    <header
      style={{
        height: '52px',
        background: '#0A0A0A',
        borderBottom: '1px solid #F5C842',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1 }}>
        <Logo size={30} />
      </div>

      <div style={{ flex: 1, textAlign: 'center' }}>
        <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '14px', fontFamily: 'Inter, sans-serif' }}>
          {title}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => window.close()}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            fontSize: '20px',
            lineHeight: 1,
            padding: '4px 8px',
            borderRadius: '6px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
        >
          ✕
        </button>
      </div>
    </header>
  )
}
