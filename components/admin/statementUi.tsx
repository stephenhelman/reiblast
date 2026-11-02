import React from "react";
import { Banner } from "@/components/admin/ui";
import type { StaleSource } from "@/lib/billing/statement/freshness";
import { fmtDenver } from "@/lib/admin/format";

export function StatusBadge({ basis }: { basis: "estimate" | "actual" }) {
  return basis === "actual" ? (
    <span className="inline-block rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Actual</span>
  ) : (
    <span className="inline-block rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">Estimate</span>
  );
}

/** ?notice= / ?error= from the server actions. */
export function Notice({ notice, error }: { notice?: string | null; error?: string | null }) {
  if (error) return <Banner tone="bad">{error}</Banner>;
  if (notice) return <div className="mt-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>;
  return null;
}

export function StaleBanner({ sources }: { sources: StaleSource[] }) {
  if (sources.length === 0) return null;
  return (
    <Banner tone="warn">
      <strong>Data may be out of date.</strong>{" "}
      {sources.map((s) => `${s.label}: ${s.asOf ? `last updated ${fmtDenver(s.asOf)}` : "no data loaded"}`).join(" · ")}. Figures below only include what has been ingested; a source older than 26 hours usually means its scheduled job isn&apos;t running.
    </Banner>
  );
}

export const inputCls = "mt-1 block w-full rounded-lg border border-border-default bg-black px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-gold focus:outline-none";
export const labelCls = "block text-xs text-white/50";
export const btnCls = "rounded-lg bg-gold px-4 py-1.5 text-sm font-semibold text-black hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-40";
export const ghostBtnCls = "rounded-lg border border-border-default px-4 py-1.5 text-sm font-semibold text-white/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
