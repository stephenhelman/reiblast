'use client'

import { useState } from 'react'
import { MAO_MULTIPLIER } from '@/lib/constants'

interface Inputs {
  arv: string
  repairs: string
  assignmentFee: string
}

interface Results {
  mao: number
  score: 'strong' | 'borderline' | 'pass'
  profit: number
}

const scoreStyles = {
  strong: { color: '#4ade80', label: 'Strong Deal' },
  borderline: { color: '#facc15', label: 'Borderline' },
  pass: { color: '#f87171', label: 'Pass' },
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export default function WidgetAnalyzerPage() {
  const [inputs, setInputs] = useState<Inputs>({ arv: '', repairs: '', assignmentFee: '' })
  const [asking, setAsking] = useState('')
  const [results, setResults] = useState<Results | null>(null)

  function calculate() {
    const arv = parseFloat(inputs.arv)
    const repairs = parseFloat(inputs.repairs)
    const fee = parseFloat(inputs.assignmentFee)
    const ask = parseFloat(asking)
    if ([arv, repairs, fee, ask].some(isNaN)) return

    const mao = arv * MAO_MULTIPLIER - repairs - fee
    let score: Results['score']
    if (mao >= ask) score = 'strong'
    else if (mao >= ask * 0.9) score = 'borderline'
    else score = 'pass'
    setResults({ mao, score, profit: mao - ask })
  }

  const inputStyle = {
    width: '100%',
    background: '#1C1C1C',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    padding: '8px 12px',
    fontSize: '13px',
    outline: 'none',
    fontFamily: 'Inter, sans-serif',
  }

  return (
    <div
      style={{
        width: '600px',
        background: '#0A0A0A',
        color: '#fff',
        fontFamily: 'Inter, sans-serif',
        padding: '20px',
        fontSize: '13px',
      }}
    >
      <p style={{ color: '#F5C842', fontWeight: 600, marginBottom: '12px', fontSize: '14px' }}>
        Deal Analyzer
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        {[
          { label: 'Asking Price', key: 'asking', value: asking, setter: setAsking },
        ].map(({ label, key, value, setter }) => (
          <div key={key}>
            <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>{label}</p>
            <input style={inputStyle} type="number" placeholder="120000" value={value} onChange={(e) => setter(e.target.value)} />
          </div>
        ))}
        {([
          ['ARV', 'arv'],
          ['Repairs', 'repairs'],
          ['Assignment Fee', 'assignmentFee'],
        ] as const).map(([label, key]) => (
          <div key={key}>
            <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>{label}</p>
            <input
              style={inputStyle}
              type="number"
              placeholder="0"
              value={inputs[key]}
              onChange={(e) => setInputs((p) => ({ ...p, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <button
        onClick={calculate}
        style={{
          width: '100%',
          background: '#F5C842',
          color: '#000',
          fontWeight: 700,
          border: 'none',
          borderRadius: '8px',
          padding: '10px',
          cursor: 'pointer',
          marginBottom: '12px',
          fontSize: '13px',
        }}
      >
        Calculate MAO
      </button>

      {results && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px',
            background: '#141414',
            border: '1px solid #F5C842',
            borderRadius: '10px',
            padding: '12px',
          }}
        >
          <div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>MAO</p>
            <p style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>{fmt(results.mao)}</p>
          </div>
          <div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Score</p>
            <p style={{ color: scoreStyles[results.score].color, fontWeight: 700, fontSize: '14px' }}>
              {scoreStyles[results.score].label}
            </p>
          </div>
          <div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Profit</p>
            <p style={{ color: results.profit >= 0 ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: '16px' }}>{fmt(results.profit)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
