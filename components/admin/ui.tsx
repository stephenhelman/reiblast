import React from "react";
import Card from "@/components/shared/Card";
import type { Badge } from "@/lib/billing/reports/health";

const TONE: Record<Badge["tone"], string> = {
  ok: "border-emerald-500/40 text-emerald-300",
  warn: "border-gold/50 text-gold",
  bad: "border-red-500/50 text-red-300",
};

export function BadgeRow({ badges }: { badges: Badge[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {badges.map((b) => (
        <div key={b.key} className={`rounded-lg border bg-surface px-4 py-3 ${TONE[b.tone]}`}>
          <div className="text-xs uppercase tracking-wide text-white/50">{b.label}</div>
          <div className="mt-1 text-sm font-semibold">{b.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {note && <p className="mt-1 text-sm text-white/50">{note}</p>}
      <Card className="mt-3 overflow-x-auto p-0">{children}</Card>
    </section>
  );
}

export function Table({ head, rows, empty = "None." }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="px-6 py-4 text-sm text-white/50">{empty}</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border-default text-xs uppercase tracking-wide text-white/40">
          {head.map((h) => (
            <th key={h} className="px-4 py-2 font-medium">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border-default/50 last:border-0">
            {r.map((c, j) => (
              <td key={j} className="px-4 py-2 align-top text-white/80">{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Banner({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  return <div className={`mt-6 rounded-lg border px-4 py-3 text-sm ${tone === "bad" ? "border-red-500/60 bg-red-500/10 text-red-200" : "border-gold/60 bg-gold/10 text-gold"}`}>{children}</div>;
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">{children}</h1>
      {sub && <p className="mt-1 text-sm text-white/50">{sub}</p>}
    </div>
  );
}

export function GateScreen({ title, message, children }: { title: string; message?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-8 text-center">
        <h1 className="mb-2 text-xl font-bold text-white">{title}</h1>
        {message && <p className="text-sm leading-relaxed text-white/50">{message}</p>}
        {children}
      </div>
    </div>
  );
}

export const CodeInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="w-full rounded-xl border border-border-default bg-black px-4 py-3 text-center text-lg tracking-[0.2em] text-white placeholder:tracking-normal placeholder:text-white/30 focus:border-gold focus:outline-none"
  />
);
