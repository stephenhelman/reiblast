import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'

interface SavedLandComp {
  address: string
  lotSizeAcres: number | null
  lastSalePrice: number | null
  taxAssessedLandValue: number | null
  pricePerSqft: number | null
  daysSinceSold: number | null
  classification: 'VACANT_LAND' | 'TEARDOWN' | 'UNKNOWN'
  weight: 'high' | 'medium' | 'low'
  priceSource: 'sale' | 'history' | 'assessment' | 'none'
  source: 'rentcast' | 'manual'
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function relativeDate(daysAgo: number | null): string {
  if (daysAgo == null) return '—'
  if (daysAgo <= 90) return `${daysAgo}d ago`
  if (daysAgo <= 365) return `${Math.round(daysAgo / 30)}mo ago`
  return `${Math.round(daysAgo / 365)}yr ago`
}

export default async function LandDealReportPage({
  params,
}: {
  params: { id: string }
}) {
  const deal = await prisma.landDeal.findUnique({ where: { id: params.id } })
  if (!deal) notFound()

  const analyzedOn = deal.createdAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  let comps: SavedLandComp[] = []
  if (deal.compsJson) {
    try {
      comps = JSON.parse(deal.compsJson) as SavedLandComp[]
    } catch {
      // malformed — render without comps
    }
  }

  const keepPct = deal.discount != null ? 1 - deal.discount / 100 : null

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-border-default px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <span className="font-bold text-white text-lg tracking-tight shrink-0">REIblast</span>
          <p className="text-white font-semibold text-sm text-center truncate">{deal.address}</p>
          <p className="text-white/40 text-xs shrink-0">Analyzed on {analyzedOn}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Estimated Value + Builder Activity */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-gold rounded-xl p-5">
            <p className="text-gold text-[10px] uppercase tracking-wider mb-1">Estimated Value</p>
            {deal.estimatedValueLow != null && deal.estimatedValueHigh != null && (
              <p className="text-white/40 text-xs mb-1">
                {fmt(deal.estimatedValueLow)} — {fmt(deal.estimatedValueHigh)}
              </p>
            )}
            <p className="text-white text-2xl font-bold mb-2">{fmt(deal.estimatedValue)}</p>
            {deal.valueConfidence && (
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                  deal.valueConfidence === 'high'
                    ? 'bg-green-400/15 text-green-400'
                    : deal.valueConfidence === 'medium'
                    ? 'bg-yellow-400/15 text-yellow-400'
                    : 'bg-red-400/15 text-red-400'
                }`}>
                  {deal.valueConfidence} confidence
                </span>
                {deal.valueMethod && (
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-white/5 text-white/50 capitalize">
                    {deal.valueMethod.replace('_', ' ')}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border-default rounded-xl p-5">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Builder Activity</p>
            {deal.builderActivityLevel && (
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mb-3 ${
                deal.builderActivityLevel === 'high'
                  ? 'bg-green-400/15 text-green-400'
                  : deal.builderActivityLevel === 'moderate'
                  ? 'bg-yellow-400/15 text-yellow-400'
                  : deal.builderActivityLevel === 'low'
                  ? 'bg-white/5 text-white/50'
                  : 'bg-white/5 text-white/30'
              }`}>
                {deal.builderActivityLevel}
              </span>
            )}
            {deal.builderActivityNote && (
              <p className="text-white/60 text-xs leading-relaxed">{deal.builderActivityNote}</p>
            )}
          </div>
        </div>

        {/* Subject chips */}
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Lot Size', value: deal.lotSizeAcres != null ? `${deal.lotSizeAcres.toFixed(2)} ac` : null },
            { label: 'Zoning', value: deal.zoning },
            { label: 'Road Access', value: deal.roadAccess },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-2 rounded-lg px-3 py-2">
              <p className="text-white/30 text-[10px]">{label}</p>
              <p className={`font-semibold text-sm ${value ? 'text-white' : 'text-white/30'}`}>
                {value ?? 'Not provided'}
              </p>
            </div>
          ))}
        </div>

        {/* Offer summary */}
        <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
          <div className="divide-y divide-border-default">
            {deal.discount != null && (
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-white/50 text-sm">Discount</span>
                <span className="text-white font-semibold text-sm">{deal.discount}%</span>
              </div>
            )}
            {keepPct != null && (
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-white/50 text-sm">Keep %</span>
                <span className="text-white font-semibold text-sm">{Math.round(keepPct * 100)}%</span>
              </div>
            )}
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">End Buyer Max</span>
              <span className="text-white font-semibold text-sm">{fmt(deal.endBuyerMax)}</span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">Wholesale Fee</span>
              <span className="text-white font-semibold text-sm">{fmt(deal.wholesaleFee)}</span>
            </div>
            <div className="flex items-center justify-between px-5 py-4 bg-gold/10">
              <span className="text-gold font-bold text-base">Cash Offer</span>
              <span className="text-gold font-bold text-xl">{fmt(deal.cashOffer)}</span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-white font-semibold text-sm">Anchor Offer</p>
                <p className="text-white/30 text-xs mt-0.5">Start here — negotiate up to cash offer</p>
              </div>
              <span className="text-white font-bold text-lg">{fmt(deal.anchorOffer)}</span>
            </div>
          </div>
        </div>

        {/* Comp breakdown */}
        {comps.length > 0 && (
          <div>
            <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Comp Breakdown</p>
            <div className="space-y-2">
              {comps.map((comp, i) => (
                <div key={i} className="bg-surface border border-border-default rounded-xl p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-white text-xs font-semibold truncate">{comp.address}</p>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      comp.classification === 'VACANT_LAND'
                        ? 'bg-green-400/15 text-green-400'
                        : comp.classification === 'TEARDOWN'
                        ? 'bg-orange-400/15 text-orange-400'
                        : 'bg-white/5 text-white/40'
                    }`}>
                      {comp.classification?.replace('_', ' ') ?? 'UNKNOWN'}
                    </span>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      comp.weight === 'high'
                        ? 'bg-green-400/10 text-green-400'
                        : comp.weight === 'medium'
                        ? 'bg-yellow-400/10 text-yellow-400'
                        : 'bg-white/5 text-white/40'
                    }`}>
                      {comp.weight} weight
                    </span>
                    {comp.source === 'manual' && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-medium">Manual</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <p className="text-white/25 text-[10px]">Lot size</p>
                      <p className="text-white/70 text-xs font-medium">
                        {comp.lotSizeAcres != null ? comp.lotSizeAcres.toFixed(2) + ' ac' : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/25 text-[10px]">Sale price</p>
                      <p className="text-white/70 text-xs font-medium">
                        {fmt(comp.lastSalePrice)}
                        {comp.priceSource === 'assessment' && (
                          <span className="ml-1 text-[9px] text-white/30">Assessed</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/25 text-[10px]">Tax assessed</p>
                      <p className="text-white/70 text-xs font-medium">{fmt(comp.taxAssessedLandValue)}</p>
                    </div>
                    <div>
                      <p className="text-white/25 text-[10px]">Days since sold</p>
                      <p className="text-white/70 text-xs font-medium">{relativeDate(comp.daysSinceSold)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Narrative */}
        {deal.narrative && (
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">AI Narrative</p>
            <p className="text-white text-sm leading-relaxed">{deal.narrative}</p>
          </div>
        )}

        {/* Risks */}
        {deal.risks.length > 0 && (
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Risks</p>
            <ul className="space-y-1.5">
              {deal.risks.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-white/70">
                  <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {deal.warnings.length > 0 && (
          <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-xl p-4">
            <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-2">Flags</p>
            <ul className="space-y-1">
              {deal.warnings.map((w, i) => (
                <li key={i} className="text-yellow-400/70 text-xs flex gap-2">
                  <span className="mt-0.5 shrink-0">⚠</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border-default py-8 text-center">
        <a
          href="https://tools.reiblast.app/tools/analyzer"
          className="text-white/30 text-xs hover:text-white/60 transition-colors"
        >
          Powered by REIblast
        </a>
      </div>
    </div>
  )
}
