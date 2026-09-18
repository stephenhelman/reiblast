// Single shared revenue/cost/margin computation for every admin money
// surface (Overview lib/adminDashboard.ts, Tools lib/adminTools.ts,
// Members lib/adminMembersList.ts, and the [slug] deep page). Same spirit
// as getRentcastEconomics: one formula, every caller imports it — no surface
// computes revenue or margin on its own.
//
// WHY THIS EXISTS: the three surfaces used to each roll their own revenue
// math and quietly diverged —
//   1. Overview and Tools both attributed the FULL bots-feature subscription
//      revenue to EACH of REI/acq and REI/dispo (they share one Subscription
//      row via one Feature — there's no per-mark subscription row) —
//      double-counting it, so sum(per-tool revenue) > Overview's total.
//   2. Overview attributed Rentcast cost by grouping ApiCall rows on the
//      denormalized `ApiCall.featureSlug` field directly; Tools/the deep
//      page instead join ApiCall.toolUseId -> the window-scoped ToolUse rows
//      first. For the acq/dispo split those two methods disagree (ApiCall
//      has no `kind`, so featureSlug-grouping can't tell acq's Rentcast
//      calls from dispo's — it re-doubles the same total onto both), and
//      even for non-split tools the two joins can drift when a call's own
//      createdAt falls in-window but its parent run's doesn't (or vice
//      versa). Cost must ALWAYS be attributed via the toolUseId join.
//   3. Overview/Tools' headline "revenue" totals only ever counted
//      subscription price — never LedgerEntry credit revenue (that table
//      was read only for the chart's per-day *shape*, never summed into the
//      flat total). Members separately started summing credit revenue into
//      its total. Two different definitions of "revenue" under one word.
//
// THE FIX, one shared definition everywhere:
//   revenue = subscriptionRevenueCents (current-period MRR snapshot for
//             active, non-admin subscriptions — Stripe isn't wired, so this
//             stays the existing "estimated from Tier.priceCents" reading;
//             see note on subscriptionRevenueByFeatureId) + creditRevenueCents
//             (credit-covered consumption rows x Feature.creditCost x $0.25)
//   cost    = non-Rentcast ApiCall.costCents, joined via toolUseId -> the
//             window-scoped run set (or, for Members, via locationId — see
//             that file) + this scope's Rentcast call count x the vendor's
//             read-side per-call cost (getRentcastEconomics)
//   margin  = revenue - cost
//
// A NOTE ON "REVENUE OVER THE WINDOW": subscription revenue is reported as
// a current-MRR snapshot (this period's price for every currently-active,
// non-admin subscription), constant across Range — the same convention
// every SaaS MRR dashboard uses, and the only one supportable by the data we
// actually retain: Subscription keeps only the CURRENT periodStart/periodEnd,
// not a per-period history, so there is no reliable way to multiply
// "monthly price x N elapsed months" for a wide window like "All time"
// without fabricating a period count. What Range DOES correctly window is
// usage: cost (ApiCall) and credit revenue (LedgerEntry consumption) are
// real, timestamped events, so they're filtered to the window like always.
// If per-period billing history is added later (e.g. a Transaction row per
// renewal), swap subscriptionRevenueByFeatureId for a real window-sum over
// that table — the call sites here don't change.
//
// SHARED-FEATURE ATTRIBUTION (acq/dispo -> bots): subscription revenue has
// no per-mark row to read — REI/acq and REI/dispo bill off the same `bots`
// Subscription. splitSharedFeatureRevenue divides one feature's revenue
// across every Tool mark that shares it, weighted by each mark's run count
// in scope (falling back to an even split when nobody has run yet), using an
// integer-safe (largest-remainder) split so per-mark shares always sum back
// to EXACTLY the feature total — no double count, no leftover cent.
// Non-shared features are just the degenerate one-mark case of the same
// function, so every tool goes through one code path, not a bots special
// case. Credit revenue needs no such split: LedgerEntry.toolId already
// records which mark earned each credit-covered run.

import { CREDIT_DOLLARS_PER_CREDIT_CENTS } from "@/lib/adminDashboard";

export { CREDIT_DOLLARS_PER_CREDIT_CENTS };

export type SubRevenueInput = { status: string; featureId: string; priceCents: number; userRole: string };

/** Current-period MRR snapshot, keyed by featureId — active, non-admin subscriptions only. */
export function subscriptionRevenueByFeatureId(subs: SubRevenueInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of subs) {
    if (s.userRole === "admin" || s.status !== "active") continue;
    map.set(s.featureId, (map.get(s.featureId) ?? 0) + s.priceCents);
  }
  return map;
}

/** credit-covered consumption count x Feature.creditCost x $0.25 — the one credit-revenue formula. */
export function creditRevenueCents(creditCoveredRunCount: number, featureCreditCost: number): number {
  return creditCoveredRunCount * featureCreditCost * CREDIT_DOLLARS_PER_CREDIT_CENTS;
}

/**
 * Largest-remainder integer split — shares always sum to exactly `total`.
 * Exported so callers can exact-split a rounded total (e.g. Rentcast's
 * amortized cost) across scopes without each scope's independent
 * Math.round() drifting the sum away from the total by a cent or two — the
 * same class of bug splitSharedFeatureRevenue fixes for revenue.
 */
export function splitIntegerProportional(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const evenWeights = weightSum > 0 ? weights : weights.map(() => 1);
  const evenSum = weightSum > 0 ? weightSum : weights.length;
  const raw = evenWeights.map((w) => (total * w) / evenSum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i] += 1;
  }
  return result;
}

/**
 * Splits one feature's subscription revenue across every Tool mark sharing
 * it (weighted by run count), so per-mark shares sum EXACTLY back to the
 * feature total. `marks` is every Tool row (its own featureId, plus a
 * `weight` — typically its run count in scope); tools that don't share a
 * featureId with anyone else are the trivial one-mark group (share = full
 * amount, via the same code path).
 */
export function splitSharedFeatureRevenue(
  revenueByFeatureId: Map<string, number>,
  marks: { markKey: string; featureId: string; weight: number }[],
): Map<string, number> {
  const byFeature = new Map<string, { markKey: string; weight: number }[]>();
  for (const m of marks) {
    const arr = byFeature.get(m.featureId) ?? [];
    arr.push({ markKey: m.markKey, weight: m.weight });
    byFeature.set(m.featureId, arr);
  }
  const result = new Map<string, number>();
  for (const [featureId, group] of byFeature) {
    const total = revenueByFeatureId.get(featureId) ?? 0;
    const shares = splitIntegerProportional(
      total,
      group.map((g) => g.weight),
    );
    group.forEach((g, i) => result.set(g.markKey, shares[i]));
  }
  return result;
}

export type CostableCall = { costCents: number | null };

/**
 * The ONE cost attribution formula. Callers pass in the calls ALREADY joined
 * to their scope (via ApiCall.toolUseId -> a window-scoped ToolUse id set for
 * a tool-shaped scope, or via ApiCall.locationId for a member-shaped scope —
 * see each surface) — this function never re-derives that join, it just sums.
 * rentcastCallCount must come from the SAME join, never from grouping on the
 * denormalized ApiCall.featureSlug field (see file header note #2).
 */
export function attributedCostCents(
  nonRentcastCalls: CostableCall[],
  rentcastCallCount: number,
  rentcastPerCallCostCents: number,
): { totalCostCents: number; nonRentcastCostCents: number; rentcastCostCents: number; unknownCalls: number } {
  let nonRentcastCostCents = 0;
  let unknownCalls = 0;
  for (const c of nonRentcastCalls) {
    if (c.costCents === null) unknownCalls += 1;
    else nonRentcastCostCents += c.costCents;
  }
  const rentcastCostCents = Math.round(rentcastCallCount * rentcastPerCallCostCents);
  return { totalCostCents: nonRentcastCostCents + rentcastCostCents, nonRentcastCostCents, rentcastCostCents, unknownCalls };
}

export function marginCents(revenueCents: number, costCents: number): number {
  return revenueCents - costCents;
}
