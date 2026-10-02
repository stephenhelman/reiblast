import Link from "next/link";
import React from "react";
import { adminHref, exportHref, qs, type Q } from "@/lib/admin/links";

/** Server-side CSV download link. `params` are the SAME filters the page is showing. */
export function ExportButton({ view, params, label = "Export CSV" }: { view: string; params: Q; label?: string }) {
  return (
    <a href={exportHref(view, params)} className="inline-flex items-center rounded-lg border border-gold/50 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/10">
      {label}
    </a>
  );
}

/** GET form: month range (+ any hidden filters that must survive a re-query). */
export function RangeForm({ from, to, hidden = {} }: { from: string; to: string; hidden?: Q }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      {Object.entries(hidden).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <label className="text-xs text-white/50">
        From
        <input type="month" name="from" defaultValue={from} min="2026-06" className="mt-1 block rounded-lg border border-border-default bg-black px-3 py-1.5 text-sm text-white" />
      </label>
      <label className="text-xs text-white/50">
        To
        <input type="month" name="to" defaultValue={to} min="2026-06" className="mt-1 block rounded-lg border border-border-default bg-black px-3 py-1.5 text-sm text-white" />
      </label>
      <button type="submit" className="rounded-lg bg-gold px-4 py-1.5 text-sm font-semibold text-black hover:bg-gold-hover">Apply</button>
    </form>
  );
}

/** Column header that toggles sort via the URL (server-rendered; no client JS). */
export function SortHeader({ base, path, params, sortKey, label, current, dir }: { base: string; path: string; params: Q; sortKey: string; label: string; current: string; dir: "asc" | "desc" }) {
  const active = current === sortKey;
  const next = active && dir === "desc" ? "asc" : "desc";
  return (
    <Link href={adminHref(base, path, { ...params, sort: sortKey, dir: next })} className={active ? "text-gold" : "hover:text-white"}>
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </Link>
  );
}

export function Pager({ base, path, params, nextCursor, shown }: { base: string; path: string; params: Q; nextCursor: string | null; shown: number }) {
  return (
    <div className="flex items-center justify-between border-t border-border-default px-4 py-3 text-sm text-white/50">
      <span>{shown} rows on this page</span>
      <span className="flex gap-4">
        {params.after ? <Link className="text-gold hover:underline" href={adminHref(base, path, { ...params, after: undefined })}>← First page</Link> : null}
        {nextCursor ? <Link className="text-gold hover:underline" href={adminHref(base, path, { ...params, after: nextCursor })}>Next page →</Link> : <span>End of list</span>}
      </span>
    </div>
  );
}

export const Money = ({ children, neg }: { children: React.ReactNode; neg?: boolean }) => <span className={`tabular-nums ${neg ? "text-red-300" : ""}`}>{children}</span>;
export const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs text-white/80">{children}</span>;
export { qs };
