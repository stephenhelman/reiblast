import { LogoFull } from '@/components/shared/Logo'

export default function WidgetHeaderPage() {
  return (
    <div
      style={{
        height: '80px',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0A0A0A 0%, #141414 100%)',
        border: '1px solid #F5C842',
        borderRadius: '12px',
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'Inter, sans-serif',
        position: 'relative',
      }}
    >
      {/* Silver accent line at bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'rgba(192,192,192,0.15)',
        }}
      />

      <LogoFull size={36} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(245,200,66,0.12)',
          border: '1px solid rgba(245,200,66,0.35)',
          borderRadius: '999px',
          padding: '6px 14px',
        }}
      >
        <div
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: '#F5C842',
          }}
        />
        <span style={{ color: '#F5C842', fontSize: '13px', fontWeight: 600 }}>Core Plan</span>
      </div>
    </div>
  )
}
