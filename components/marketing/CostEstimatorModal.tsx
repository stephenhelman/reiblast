"use client";

import { useMemo, useState } from "react";
import {
  CORE_PRICE,
  PHONE_PRICE,
  A2P_SETUP,
  A2P_MONTHLY_SOLE,
  A2P_MONTHLY_LLC,
  TEXT_RATE,
  DAILY_CAP_SOLE,
  DAILY_CAP_LLC,
  SEND_DAYS,
  RAMP_RUNGS,
  TRIAL_DAYS,
} from "@/lib/pricing";

type AccountType = "sole" | "llc";

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatMoney(n: number) {
  return `$${round2(n).toFixed(2)}`;
}

function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}

function month1TextCount(target: number) {
  const sendingDays = SEND_DAYS - TRIAL_DAYS;
  let total = 0;
  let rungIndex = 0;
  for (let day = 0; day < sendingDays; day++) {
    const rung = RAMP_RUNGS[Math.min(rungIndex, RAMP_RUNGS.length - 1)];
    const sent = Math.min(rung, target);
    total += sent;
    if (rung < target) rungIndex++;
  }
  return total;
}

function InfoTooltip({ content }: { content: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center ml-1.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="More info"
        className="w-4 h-4 rounded-full border border-white/30 text-white/50 hover:text-white hover:border-white/60 text-[10px] font-bold flex items-center justify-center transition-colors"
      >
        i
      </button>
      {open && (
        <span className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-black border border-gold/30 rounded-lg p-3 text-xs text-white/70 leading-relaxed shadow-xl">
          {content}
        </span>
      )}
    </span>
  );
}

function CostEstimatorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [accountType, setAccountType] = useState<AccountType>("sole");
  const [numbers, setNumbers] = useState(1);
  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  const [textsPerDay, setTextsPerDay] = useState(500);

  const dailyCap = accountType === "sole" ? DAILY_CAP_SOLE : DAILY_CAP_LLC;
  const a2pMonthly =
    accountType === "sole" ? A2P_MONTHLY_SOLE : A2P_MONTHLY_LLC;
  const effectiveNumbers = accountType === "sole" ? 1 : numbers;
  const target = Math.min(textsPerDay, dailyCap);

  const setAccountTypeAndClamp = (next: AccountType) => {
    setAccountType(next);
    const nextCap = next === "sole" ? DAILY_CAP_SOLE : DAILY_CAP_LLC;
    setTextsPerDay((v) => Math.min(v, nextCap));
    if (next === "sole") setNumbers(1);
  };

  const setTextsClamped = (v: number) => {
    if (Number.isNaN(v)) v = 0;
    setTextsPerDay(Math.max(0, Math.min(v, dailyCap)));
  };

  const dailyTextCost = target * TEXT_RATE;
  const fixedMonthly = CORE_PRICE + effectiveNumbers * PHONE_PRICE + a2pMonthly;

  const month1Texts = useMemo(() => month1TextCount(target), [target]);
  const flatMonthTexts = target * SEND_DAYS;

  const phoneCost = effectiveNumbers * PHONE_PRICE;

  const months = [
    {
      label: "Month 1",
      texts: month1Texts,
      textCost: round2(month1Texts * TEXT_RATE),
      a2pSetup: A2P_SETUP,
      a2pMonthlyFee: 0,
      tooltip: (
        <>
          Week 1 is your free trial — nothing sends. Sending starts week 2 and
          climbs (500, 750, 1,000, 1,500…) toward your target of{" "}
          {formatNumber(target)}/day before it levels off, so Month 1 sends
          fewer texts than a full month.
        </>
      ),
    },
    {
      label: "Month 2",
      texts: flatMonthTexts,
      textCost: round2(flatMonthTexts * TEXT_RATE),
      a2pSetup: 0,
      a2pMonthlyFee: a2pMonthly,
      tooltip: (
        <>
          {formatNumber(target)} texts/day × 22 sending days (Mon–Fri) ={" "}
          {formatNumber(flatMonthTexts)} texts, at $0.0091 per text.
        </>
      ),
    },
    {
      label: "Month 3",
      texts: flatMonthTexts,
      textCost: round2(flatMonthTexts * TEXT_RATE),
      a2pSetup: 0,
      a2pMonthlyFee: a2pMonthly,
      tooltip: (
        <>
          {formatNumber(target)} texts/day × 22 sending days (Mon–Fri) ={" "}
          {formatNumber(flatMonthTexts)} texts, at $0.0091 per text.
        </>
      ),
    },
  ];

  const monthTotals = months.map((m) =>
    round2(
      CORE_PRICE + round2(phoneCost) + m.a2pMonthlyFee + m.a2pSetup + m.textCost
    )
  );
  const grandTotal = round2(monthTotals.reduce((a, b) => a + b, 0));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full text-left my-auto"
        style={{
          maxWidth: 640,
          background: "#141414",
          border: "1px solid rgba(245,200,66,0.3)",
          borderRadius: 20,
          padding: 32,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          ✕
        </button>

        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-2">
          Cost Estimator
        </p>
        <h2 className="text-white text-2xl font-extrabold mb-6">
          Calculate My Costs
        </h2>

        {/* Gating questions */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide mb-2">
              Account type
            </p>
            <div className="flex rounded-lg border border-border-default overflow-hidden">
              <button
                onClick={() => setAccountTypeAndClamp("sole")}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                  accountType === "sole"
                    ? "bg-gold text-black"
                    : "bg-surface text-white/60 hover:text-white"
                }`}
              >
                Sole Proprietor
              </button>
              <button
                onClick={() => setAccountTypeAndClamp("llc")}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                  accountType === "llc"
                    ? "bg-gold text-black"
                    : "bg-surface text-white/60 hover:text-white"
                }`}
              >
                LLC/EIN
              </button>
            </div>
          </div>

          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide mb-2">
              Phone numbers
            </p>
            {accountType === "sole" ? (
              <div className="flex items-center h-[42px] px-4 rounded-lg border border-border-default bg-surface text-white/50 text-sm">
                1 (locked for sole proprietors)
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNumbers((n) => Math.max(1, n - 1))}
                  className="w-[42px] h-[42px] rounded-lg border border-border-default bg-surface text-white/70 hover:text-white transition-colors"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={numbers}
                  onChange={(e) =>
                    setNumbers(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  className="flex-1 h-[42px] px-3 rounded-lg border border-border-default bg-surface text-white text-sm text-center"
                />
                <button
                  onClick={() => setNumbers((n) => n + 1)}
                  className="w-[42px] h-[42px] rounded-lg border border-border-default bg-surface text-white/70 hover:text-white transition-colors"
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg border border-border-default overflow-hidden mb-6">
          <button
            onClick={() => setTab("daily")}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === "daily"
                ? "bg-gold text-black"
                : "bg-surface text-white/60 hover:text-white"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setTab("monthly")}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === "monthly"
                ? "bg-gold text-black"
                : "bg-surface text-white/60 hover:text-white"
            }`}
          >
            Monthly
          </button>
        </div>

        {/* Shared texts/day control */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">
              Texts per day
            </p>
            <input
              type="number"
              min={0}
              max={dailyCap}
              value={textsPerDay}
              onChange={(e) => setTextsClamped(parseInt(e.target.value, 10))}
              className="w-24 h-9 px-2 rounded-lg border border-border-default bg-surface text-white text-sm text-right"
            />
          </div>
          <input
            type="range"
            min={0}
            max={dailyCap}
            step={10}
            value={target}
            onChange={(e) => setTextsClamped(parseInt(e.target.value, 10))}
            className="w-full accent-gold"
          />
          <p className="text-white/30 text-xs mt-1">
            Cap: {formatNumber(dailyCap)}/day (
            {accountType === "sole" ? "sole proprietor" : "LLC/EIN"})
          </p>
        </div>

        {tab === "daily" ? (
          <div className="bg-black border border-border-default rounded-xl p-6">
            <p className="text-white/50 text-xs uppercase tracking-wide mb-2">
              Daily texting cost
            </p>
            <p className="text-4xl font-bold text-gold mb-1">
              {formatMoney(dailyTextCost)}
            </p>
            <p className="text-white/40 text-sm mb-5">
              {formatNumber(target)} texts/day × $0.0091
            </p>

            <div className="border-t border-white/10 pt-4">
              <p className="text-white/50 text-sm">
                Your fixed monthly costs: {formatMoney(fixedMonthly)}
              </p>
              <p className="text-white/30 text-xs mt-1">
                Core $57 + {effectiveNumbers} number
                {effectiveNumbers === 1 ? "" : "s"} (
                {formatMoney(effectiveNumbers * PHONE_PRICE)}) + A2P monthly (
                {formatMoney(a2pMonthly)}) — not prorated into the daily
                figure above.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase tracking-wide">
                  <th className="text-left font-semibold pb-3">Item</th>
                  {months.map((m) => (
                    <th key={m.label} className="text-right font-semibold pb-3">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-white/80">
                <tr className="border-t border-white/10">
                  <td className="py-2.5">Core</td>
                  {months.map((m) => (
                    <td key={m.label} className="text-right py-2.5">
                      {formatMoney(CORE_PRICE)}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2.5">
                    Phone numbers ({effectiveNumbers} ×{" "}
                    {formatMoney(PHONE_PRICE)})
                  </td>
                  {months.map((m) => (
                    <td key={m.label} className="text-right py-2.5">
                      {formatMoney(phoneCost)}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2.5">A2P monthly</td>
                  {months.map((m) => (
                    <td key={m.label} className="text-right py-2.5">
                      {m.a2pMonthlyFee ? formatMoney(m.a2pMonthlyFee) : "—"}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2.5">A2P setup</td>
                  {months.map((m) => (
                    <td key={m.label} className="text-right py-2.5">
                      {m.a2pSetup ? formatMoney(m.a2pSetup) : "—"}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2.5">Texts</td>
                  {months.map((m) => (
                    <td key={m.label} className="text-right py-2.5">
                      <span className="inline-flex items-center justify-end">
                        {formatMoney(m.textCost)}
                        <InfoTooltip content={m.tooltip} />
                      </span>
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/20">
                  <td className="py-3 text-white font-bold">Month total</td>
                  {monthTotals.map((t, i) => (
                    <td
                      key={months[i].label}
                      className="text-right py-3 text-white font-bold"
                    >
                      {formatMoney(t)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="border-t border-gold/30 mt-2 pt-3 flex items-center justify-between">
              <span className="text-gold font-bold">3-month total</span>
              <span className="text-gold font-bold text-lg">
                {formatMoney(grandTotal)}
              </span>
            </div>
          </div>
        )}

        <p className="text-white/30 text-xs text-center mt-6">
          Estimate only — actual costs may vary.
        </p>
      </div>
    </div>
  );
}

export default function CostEstimatorButton({
  className = "",
  label = "Calculate my costs",
}: {
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          className ||
          "text-gold text-sm font-semibold hover:text-gold-hover transition-colors underline underline-offset-4"
        }
      >
        {label}
      </button>
      <CostEstimatorModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
