'use client'

import { useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Input from '@/components/shared/Input'
import { useLocationId } from '@/lib/hooks/use-location-id'
import Button from '@/components/shared/Button'
import MinimalHeader from '@/components/tools/MinimalHeader'
import { JV_SPLIT_CORE } from '@/lib/constants'

function JVForm() {
  const params = useSearchParams()
  const locationId = useLocationId()

  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    address: params.get('address') ?? '',
    market: '',
    arv: params.get('arv') ?? '',
    purchasePrice: params.get('askingPrice') ?? '',
    assignmentFee: params.get('assignmentFee') ?? '',
    notes: '',
  })

  void locationId // passed to API calls when JV submission is wired up

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="bg-gold/10 border border-gold/30 rounded-xl px-5 py-4 mb-6 flex gap-3">
        <span className="text-gold text-lg shrink-0">ℹ</span>
        <p className="text-gold text-sm leading-relaxed">
          JV deals require an executed purchase contract. Upload your signed PSA to proceed.{' '}
          <strong>Deal split: {JV_SPLIT_CORE} for Core members.</strong>
        </p>
      </div>

      <div className="bg-surface border border-border-default rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Input label="Property Address" type="text" placeholder="123 Main St, Dallas TX" value={form.address} onChange={set('address')} />
          </div>
          <Input label="Market / City" type="text" placeholder="Dallas, TX" value={form.market} onChange={set('market')} />
          <Input label="ARV" type="number" placeholder="200000" value={form.arv} onChange={set('arv')} />
          <Input label="Purchase Price" type="number" placeholder="120000" value={form.purchasePrice} onChange={set('purchasePrice')} />
          <Input label="Assignment Fee" type="number" placeholder="10000" value={form.assignmentFee} onChange={set('assignmentFee')} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-white/80">Additional Notes</label>
          <textarea
            rows={4}
            placeholder="Condition notes, seller motivation, timeline..."
            value={form.notes}
            onChange={set('notes')}
            className="bg-surface-2 text-white rounded-lg border border-white/10 focus:border-gold px-4 py-3 outline-none transition-colors placeholder:text-white/30 resize-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-white/80">Upload Contract (PSA)</label>
          <div
            className="border border-dashed border-gold/40 rounded-lg p-6 text-center cursor-pointer hover:border-gold/60 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <p className="text-gold text-sm font-medium mb-1">Click to upload</p>
            <p className="text-white/30 text-xs">PDF, DOC up to 10MB</p>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" />
          </div>
        </div>

        <div className="pt-2">
          <div className="group relative">
            <Button variant="primary" size="lg" className="w-full opacity-50 cursor-not-allowed" disabled>
              Submit JV Deal
            </Button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block">
              <div className="bg-surface border border-border-default text-white/70 text-xs px-3 py-2 rounded-lg whitespace-nowrap">
                🔒 Connect your CRM to enable submissions
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function JVPage() {
  return (
    <div className="min-h-screen bg-black">
      <MinimalHeader title="JV with Ari" />
      <Suspense>
        <JVForm />
      </Suspense>
    </div>
  )
}
