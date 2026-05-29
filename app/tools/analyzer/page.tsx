'use client'

import { useState } from 'react'
import Link from 'next/link'
import Input from '@/components/shared/Input'
import Button from '@/components/shared/Button'
import { MAO_MULTIPLIER } from '@/lib/constants'

interface DealInputs {
  address: string
  askingPrice: string
  arv: string
  repairs: string
  assignmentFee: string
}

interface DealResults {
  mao: number
  dealScore: 'strong' | 'borderline' | 'pass'
  potentialProfit: number
  dispositionTarget: number
}

function calcResults(inputs: DealInputs): DealResults | null {
  const asking = parseFloat(inputs.askingPrice)
  const arv = parseFloat(inputs.arv)
  const repairs = parseFloat(inputs.repairs)
  const fee = parseFloat(inputs.assignmentFee)
  if ([asking, arv, repairs, fee].some(isNaN)) return null

  const mao = arv * MAO_MULTIPLIER - repairs - fee

  let dealScore: DealResults['dealScore']
  if (mao >= asking) dealScore = 'strong'
  else if (mao >= asking * 0.9) dealScore = 'borderline'
  else dealScore = 'pass'

  return {
    mao,
    dealScore,
    potentialProfit: mao - asking,
    dispositionTarget: fee,
  }
}

const scoreConfig = {
  strong: { label: 'Strong Deal', color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/30' },
  borderline: { label: 'Borderline', color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  pass: { label: 'Pass', color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/30' },
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function AnalyzerPage() {
  const [inputs, setInputs] = useState<DealInputs>({
    address: '', askingPrice: '', arv: '', repairs: '', assignmentFee: '',
  })
  const [results, setResults] = useState<DealResults | null>(null)
  const [error, setError] = useState('')

  function handleCalculate() {
    setError('')
    const r = calcResults(inputs)
    if (!r) {
      setError('Please fill in all numeric fields.')
      return
    }
    setResults(r)
  }

  function set(field: keyof DealInputs) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputs((prev) => ({ ...prev, [field]: e.target.value }))
      setResults(null)
    }
  }

  const jvParams = results
    ? new URLSearchParams({
        address: inputs.address,
        arv: inputs.arv,
        askingPrice: inputs.askingPrice,
        assignmentFee: inputs.assignmentFee,
      }).toString()
    : ''

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Deal Analyzer</h1>
        <p className="text-white/50">Calculate your MAO and deal score before making an offer.</p>
      </div>

      <div className="bg-surface border border-border-default rounded-xl p-6 space-y-4 mb-6">
        <Input
          label="Property Address"
          type="text"
          placeholder="123 Main St, Dallas TX"
          value={inputs.address}
          onChange={set('address')}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Asking Price"
            type="number"
            placeholder="120000"
            value={inputs.askingPrice}
            onChange={set('askingPrice')}
          />
          <Input
            label="Estimated ARV"
            type="number"
            placeholder="200000"
            value={inputs.arv}
            onChange={set('arv')}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Estimated Repairs"
            type="number"
            placeholder="30000"
            value={inputs.repairs}
            onChange={set('repairs')}
          />
          <Input
            label="Desired Assignment Fee"
            type="number"
            placeholder="10000"
            value={inputs.assignmentFee}
            onChange={set('assignmentFee')}
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <Button variant="primary" size="lg" className="w-full" onClick={handleCalculate}>
          Calculate
        </Button>
      </div>

      {results && (
        <div className="bg-surface border border-gold rounded-xl p-6 animate-in fade-in duration-300">
          <h2 className="text-white font-semibold text-lg mb-5">Results</h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-black rounded-lg p-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">MAO</p>
              <p className="text-white text-2xl font-bold">{fmt(results.mao)}</p>
            </div>
            <div className={`rounded-lg p-4 border ${scoreConfig[results.dealScore].bg}`}>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Deal Score</p>
              <p className={`text-2xl font-bold ${scoreConfig[results.dealScore].color}`}>
                {scoreConfig[results.dealScore].label}
              </p>
            </div>
            <div className="bg-black rounded-lg p-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Potential Profit</p>
              <p className={`text-2xl font-bold ${results.potentialProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmt(results.potentialProfit)}
              </p>
            </div>
            <div className="bg-black rounded-lg p-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Disposition Target</p>
              <p className="text-white text-2xl font-bold">{fmt(results.dispositionTarget)}</p>
            </div>
          </div>

          <Link
            href={`/tools/jv?${jvParams}`}
            className="flex items-center justify-center gap-2 w-full border border-gold text-gold font-semibold py-3 rounded-lg hover:bg-gold/10 transition-colors"
          >
            Submit as JV Deal
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  )
}
