import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

interface SavedComp {
  address: string;
  salePrice: number;
  adjustedPrice: number;
  type: "RENOVATED" | "AS_IS";
  weight: "high" | "medium" | "low";
  adjustments: Array<{ label: string; amount: number }>;
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

const REPAIR_LABELS: Record<string, string> = {
  light: "Light cosmetic",
  full: "Full cosmetic + systems",
  heavy: "Heavy rehab",
};

export default async function SFRDealReportPage({
  params,
}: {
  params: { id: string };
}) {
  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal) notFound();

  const analyzedOn = deal.createdAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let comps: SavedComp[] = [];
  if (deal.compsJson) {
    try {
      comps = JSON.parse(deal.compsJson) as SavedComp[];
    } catch {
      // malformed — render without comps
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-border-default px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <span className="font-bold text-white text-lg tracking-tight shrink-0">
            REIblast
          </span>
          <p className="text-white font-semibold text-sm text-center truncate">
            {deal.address}
          </p>
          <p className="text-white/40 text-xs shrink-0">
            Analyzed on {analyzedOn}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* ARV + As-Is cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-gold rounded-xl p-5">
            <p className="text-gold text-[10px] uppercase tracking-wider mb-1">
              After Repair Value
            </p>
            {deal.arvLow != null && deal.arvHigh != null && (
              <p className="text-white/40 text-xs mb-1">
                {fmt(deal.arvLow)} — {fmt(deal.arvHigh)}
              </p>
            )}
            <p className="text-white text-2xl font-bold mb-2">
              {fmt(deal.arv)}
            </p>
            {deal.arvConfidence && (
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                  deal.arvConfidence === "high"
                    ? "bg-green-400/15 text-green-400"
                    : deal.arvConfidence === "medium"
                      ? "bg-yellow-400/15 text-yellow-400"
                      : "bg-red-400/15 text-red-400"
                }`}
              >
                {deal.arvConfidence} confidence
              </span>
            )}
          </div>

          <div className="bg-surface border border-border-default rounded-xl p-5">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
              As-Is Value
            </p>
            {deal.asIsValue != null ? (
              <>
                {deal.asIsLow != null && deal.asIsHigh != null && (
                  <p className="text-white/40 text-xs mb-1">
                    {fmt(deal.asIsLow)} — {fmt(deal.asIsHigh)}
                  </p>
                )}
                <p className="text-white text-2xl font-bold mb-2">
                  {fmt(deal.asIsValue)}
                </p>
              </>
            ) : (
              <p className="text-white/30 text-sm mt-2 mb-4">
                Not enough AS_IS comps
              </p>
            )}
            {deal.exitStrategy && (
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                  deal.exitStrategy === "WHOLESALE"
                    ? "bg-gold/15 text-gold"
                    : deal.exitStrategy === "FIX_AND_FLIP"
                      ? "bg-blue-400/15 text-blue-400"
                      : deal.exitStrategy === "SUBJECT_TO"
                        ? "bg-purple-400/15 text-purple-400"
                        : "bg-red-400/15 text-red-400"
                }`}
              >
                {deal.exitStrategy.replace(/_/g, " ")}
              </span>
            )}
          </div>
        </div>

        {/* Subject property chips */}
        <div className="flex gap-2">
          {[
            { label: "Beds", value: deal.beds },
            { label: "Baths", value: deal.baths },
            {
              label: "Sqft",
              value: deal.sqft != null ? deal.sqft.toLocaleString() : null,
            },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-2 rounded-lg px-3 py-2">
              <p className="text-white/30 text-[10px]">{label}</p>
              <p className="text-white font-semibold text-sm">{value ?? "—"}</p>
            </div>
          ))}
        </div>

        {/* Offer summary */}
        <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
          <div className="divide-y divide-border-default">
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">Repair level</span>
              <span className="text-white font-semibold text-sm">
                {REPAIR_LABELS[deal.repairLevel] ?? deal.repairLevel}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">End buyer max</span>
              <span className="text-white font-semibold text-sm">
                {fmt(deal.endBuyerMax)}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">Wholesale fee</span>
              <span className="text-white font-semibold text-sm">
                {fmt(deal.wholesaleFee)}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-4 bg-gold/10">
              <span className="text-gold font-bold text-base">MAO</span>
              <span className="text-gold font-bold text-xl">
                {fmt(deal.mao)}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">Anchor offer</span>
              <span className="text-white font-bold text-lg">
                {fmt(deal.anchorOffer)}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-white/50 text-sm">Investor %</span>
              <span className="text-white font-semibold text-sm">
                {deal.investorPct}%
              </span>
            </div>
          </div>
        </div>

        {/* Comps breakdown */}
        {comps.length > 0 && (
          <div>
            <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">
              Comp Breakdown
            </p>
            <div className="space-y-2">
              {comps.map((comp, i) => (
                <div
                  key={i}
                  className="bg-surface border border-border-default rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <p className="text-white text-xs font-semibold truncate">
                      {comp.address}
                    </p>
                    <span
                      className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        comp.type === "RENOVATED"
                          ? "bg-blue-400/15 text-blue-400"
                          : "bg-orange-400/15 text-orange-400"
                      }`}
                    >
                      {comp.type}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        comp.weight === "high"
                          ? "bg-green-400/10 text-green-400"
                          : comp.weight === "medium"
                            ? "bg-yellow-400/10 text-yellow-400"
                            : "bg-white/5 text-white/40"
                      }`}
                    >
                      {comp.weight} weight
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-white/40 text-xs line-through">
                      {fmt(comp.salePrice)}
                    </span>
                    <span className="text-white text-sm font-bold">
                      → {fmt(comp.adjustedPrice)}
                    </span>
                  </div>
                  {comp.adjustments.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {comp.adjustments.map((a, j) => (
                        <span
                          key={j}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            a.amount > 0
                              ? "bg-green-400/10 text-green-400"
                              : "bg-red-400/10 text-red-400"
                          }`}
                        >
                          {a.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Narrative */}
        <div className="bg-surface border border-border-default rounded-xl p-5">
          <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">
            AI Narrative
          </p>
          <p className="text-white text-sm leading-relaxed">{deal.narrative}</p>
        </div>

        {/* Warnings */}
        {deal.warnings.length > 0 && (
          <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-xl p-4">
            <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Flags
            </p>
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
          href="https://tools.reiblast.app/analyzer"
          className="text-white/30 text-xs hover:text-white/60 transition-colors"
        >
          Powered by REIblast
        </a>
      </div>
    </div>
  );
}
