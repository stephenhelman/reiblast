"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Recharts needs numbers, so series arrive as plot-only numbers (rounded to cents). The tables carry the exact Decimal strings. */
export type Series = { key: string; label: string; color: string };
type Props = { data: Record<string, string | number>[]; series: Series[]; stacked?: boolean; height?: number };

const AXIS = { stroke: "#888888", fontSize: 12 };
const usd = (v: unknown) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export default function MoneyChart({ data, series, stacked = true, height = 280 }: Props) {
  return (
    <div style={{ width: "100%", height }} className="px-2 pt-4">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#2A2A2A" vertical={false} />
          <XAxis dataKey="month" {...AXIS} />
          <YAxis {...AXIS} tickFormatter={(v) => `$${Number(v).toLocaleString("en-US")}`} width={72} />
          <Tooltip formatter={(v: unknown, name: unknown) => [usd(v), String(name)]} contentStyle={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 8 }} labelStyle={{ color: "#fff" }} cursor={{ fill: "rgba(245,200,66,0.06)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "a" : undefined} radius={stacked ? 0 : [3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
