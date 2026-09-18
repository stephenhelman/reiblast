// Admin Resources data layer (/admin/resources) — read-only v1. This is the
// "what do I owe my vendors" surface: rates come from VendorRate, the
// Rentcast plan/quota comes from VendorPlan, and usage is aggregated from
// ApiCall over the selected Period.
//
// Unlike Overview/Tools, this page does NOT filter admin vs client usage —
// admin-run calls are real vendor spend (Melissa/Rentcast/Anthropic bill for
// them same as any other call), so every ApiCall in the window counts.

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { RangeKey, resolveRange } from "@/lib/adminFilters";
import { getRentcastEconomics, currentVendorPeriod, RENTCAST_RESOURCE } from "@/lib/adminDashboard";

const MELISSA_RESOURCE = "melissa";
const ANTHROPIC_RESOURCE = "anthropic";
const SONNET_MODEL = "sonnet";
const HAIKU_MODEL = "haiku";

export type PerCallVendorCard = {
  kind: "per_call";
  resource: string;
  label: string;
  note: string;
  rateCents: number | null; // null = no VendorRate row configured yet
  calls: number;
  costCents: number;
  avgLatencyMs: number | null;
};

export type PlanVendorCard = {
  kind: "plan";
  resource: string;
  label: string;
  note: string;
  baseMonthlyCents: number;
  includedQuota: number;
  overageCentsPerCall: number;
  calls: number; // total calls in the vendor's own current billing period (not the Period filter — see getRentcastEconomics)
  costCents: number;
  effCentsPerCall: number;
  overageCalls: number;
  overageCostCents: number;
  fillPct: number; // calls / includedQuota, uncapped (can exceed 100)
};

export type PerTokenVendorCard = {
  kind: "per_token";
  resource: string;
  model: string;
  label: string;
  note: string;
  inputRatePerMillionCents: number | null;
  outputRatePerMillionCents: number | null;
  calls: number;
  costCents: number;
  totalTokens: number;
  avgTokensPerCall: number;
  inputTokens: number;
  outputTokens: number;
};

export type AdminResourcesData = {
  range: RangeKey;
  windowStart: string | null;
  windowEnd: string;
  totalSpendCents: number;
  totalCalls: number;
  totalAnthropicTokens: number;
  cycleResetsAt: string;
  cycleDaysLeft: number;
  melissa: PerCallVendorCard;
  rentcast: PlanVendorCard;
  sonnet: PerTokenVendorCard;
  haiku: PerTokenVendorCard;
};

async function latestRate(
  db: PrismaClient,
  resource: string,
  model: string | null,
  now: Date,
): Promise<{ flatCents: number | null; perMillionInputTokens: number | null; perMillionOutputTokens: number | null } | null> {
  const row = await db.vendorRate.findFirst({
    where: { resource, model, effectiveFrom: { lte: now } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!row) return null;
  return { flatCents: row.flatCents, perMillionInputTokens: row.perMillionInputTokens, perMillionOutputTokens: row.perMillionOutputTokens };
}

export async function getAdminResources(range: RangeKey, db: PrismaClient = defaultPrisma, customFrom?: string, customTo?: string): Promise<AdminResourcesData> {
  const now = new Date();
  const { start: windowStart, end: windowEnd } = resolveRange(range, now, customFrom, customTo);

  const [melissaRate, sonnetRate, haikuRate, rentcastEcon, vendorPlan, melissaCalls, anthropicCalls] = await Promise.all([
    latestRate(db, MELISSA_RESOURCE, null, now),
    latestRate(db, ANTHROPIC_RESOURCE, SONNET_MODEL, now),
    latestRate(db, ANTHROPIC_RESOURCE, HAIKU_MODEL, now),
    getRentcastEconomics(db, now),
    db.vendorPlan.findFirst({ where: { resource: RENTCAST_RESOURCE } }),
    db.apiCall.findMany({
      where: { resource: MELISSA_RESOURCE, createdAt: { gte: windowStart ?? undefined, lte: windowEnd } },
      select: { costCents: true, durationMs: true },
    }),
    db.apiCall.findMany({
      where: { resource: ANTHROPIC_RESOURCE, createdAt: { gte: windowStart ?? undefined, lte: windowEnd } },
      select: { model: true, costCents: true, inputTokens: true, outputTokens: true },
    }),
  ]);

  // --- Melissa: per-call ---
  const melissaCallCount = melissaCalls.length;
  const melissaCostCents = melissaCalls.reduce((s, c) => s + (c.costCents ?? 0), 0);
  const latencySamples = melissaCalls.map((c) => c.durationMs).filter((d): d is number => d !== null);
  const melissaAvgLatency = latencySamples.length > 0 ? Math.round(latencySamples.reduce((s, d) => s + d, 0) / latencySamples.length) : null;

  const melissa: PerCallVendorCard = {
    kind: "per_call",
    resource: MELISSA_RESOURCE,
    label: "Melissa",
    note: "property & owner data",
    rateCents: melissaRate?.flatCents ?? null,
    calls: melissaCallCount,
    costCents: melissaCostCents,
    avgLatencyMs: melissaAvgLatency,
  };

  // --- Rentcast: subscription plan + quota gauge, driven by VendorPlan / getRentcastEconomics (vendor's own billing period, not the Period filter) ---
  const includedQuota = vendorPlan?.includedQuota ?? 0;
  const overageCentsPerCall = vendorPlan?.overageCentsPerCall ?? 0;
  const overageCalls = Math.max(0, rentcastEcon.periodRentcastCalls - includedQuota);
  const overageCostCents = overageCalls * overageCentsPerCall;
  const fillPct = includedQuota > 0 ? Math.round((rentcastEcon.periodRentcastCalls / includedQuota) * 100) : 0;

  const rentcast: PlanVendorCard = {
    kind: "plan",
    resource: RENTCAST_RESOURCE,
    label: "Rentcast",
    note: "market & rent estimates",
    baseMonthlyCents: vendorPlan?.baseMonthlyCents ?? 0,
    includedQuota,
    overageCentsPerCall,
    calls: rentcastEcon.periodRentcastCalls,
    costCents: Math.round(rentcastEcon.periodSpendCents),
    effCentsPerCall: rentcastEcon.perCallCostCents,
    overageCalls,
    overageCostCents,
    fillPct,
  };

  // --- Sonnet / Haiku: per-token ---
  // ApiCall.model isn't a single fixed string per model — write sites use
  // "claude-sonnet", "claude-sonnet-5", etc. — so match by substring against
  // the short model key rather than requiring an exact match.
  function tokenCard(model: string, label: string, note: string, rate: typeof sonnetRate): PerTokenVendorCard {
    const calls = anthropicCalls.filter((c) => c.model?.includes(model));
    const costCents = calls.reduce((s, c) => s + (c.costCents ?? 0), 0);
    const inputTokens = calls.reduce((s, c) => s + (c.inputTokens ?? 0), 0);
    const outputTokens = calls.reduce((s, c) => s + (c.outputTokens ?? 0), 0);
    const totalTokens = inputTokens + outputTokens;
    return {
      kind: "per_token",
      resource: ANTHROPIC_RESOURCE,
      model,
      label,
      note,
      inputRatePerMillionCents: rate?.perMillionInputTokens ?? null,
      outputRatePerMillionCents: rate?.perMillionOutputTokens ?? null,
      calls: calls.length,
      costCents,
      totalTokens,
      avgTokensPerCall: calls.length > 0 ? Math.round(totalTokens / calls.length) : 0,
      inputTokens,
      outputTokens,
    };
  }

  const sonnet = tokenCard(SONNET_MODEL, "Claude Sonnet 5", "scoring & analysis", sonnetRate);
  const haiku = tokenCard(HAIKU_MODEL, "Claude Haiku", "REI/ask & bots", haikuRate);

  const totalSpendCents = melissa.costCents + rentcast.costCents + sonnet.costCents + haiku.costCents;
  const totalCalls = melissa.calls + rentcast.calls + sonnet.calls + haiku.calls;
  const totalAnthropicTokens = sonnet.totalTokens + haiku.totalTokens;

  const cycleDaysLeft = Math.max(0, Math.ceil((rentcastEcon.periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  return {
    range,
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd.toISOString(),
    totalSpendCents,
    totalCalls,
    totalAnthropicTokens,
    cycleResetsAt: rentcastEcon.periodEnd.toISOString(),
    cycleDaysLeft,
    melissa,
    rentcast,
    sonnet,
    haiku,
  };
}

// exported for tests / callers that need the raw anchor-day math without a full fetch
export { currentVendorPeriod };
