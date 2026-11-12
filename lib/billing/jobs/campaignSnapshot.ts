import type { Prisma } from "@prisma/client";
import { addMonths, currentDenverMonth, denverMonthStart } from "../reports/denver";
import { COUNTER_FIELDS, type CounterField } from "@/lib/campaign/stats";
import type { JobFn } from "./types";

/**
 * campaign_snapshot: for the Denver month that just ended, writes one CampaignSnapshot per location that has CampaignStats rows —
 * cumulative totals plus a per-(listType, listName, variant) breakdown. Monthly activity is derived later as this snapshot minus
 * the previous one. Idempotent: the unique (locationId, month) key + createMany skipDuplicates, and locations that already have the
 * month's snapshot are skipped, so re-running (or a late/duplicate trigger) never double-writes. CampaignStats is not pruned.
 *
 * CampaignStats has no per-event timestamps, so the snapshot is "as of when the job ran": trigger it just after the month turns over
 * (the 1st). Stats rows first created after the month ended are left out of that month's snapshot.
 */
const CHUNK = 100;
type StatsRow = { locationId: string; listType: string; listName: string; variant: string; firstEventAt: Date } & Record<CounterField, number>;

export const runCampaignSnapshot: JobFn = async (ctx) => {
  const month = addMonths(currentDenverMonth(ctx.now), -1);
  const monthEnd = denverMonthStart(addMonths(month, 1));
  const rows = (await ctx.db.campaignStats.findMany({ where: { firstEventAt: { lt: monthEnd } } })) as unknown as StatsRow[];
  const have = new Set((await ctx.db.campaignSnapshot.findMany({ where: { month }, select: { locationId: true } })).map((r) => r.locationId));

  const byLoc = new Map<string, StatsRow[]>();
  for (const r of rows) byLoc.set(r.locationId, [...(byLoc.get(r.locationId) ?? []), r]);

  const data: Prisma.CampaignSnapshotCreateManyInput[] = [];
  for (const [locationId, list] of byLoc) {
    if (have.has(locationId)) continue;
    const totals = Object.fromEntries(COUNTER_FIELDS.map((f) => [f, list.reduce((n, r) => n + r[f], 0)])) as Record<CounterField, number>;
    const breakdown = list
      .map((r) => ({ listType: r.listType, listName: r.listName, variant: r.variant, ...Object.fromEntries(COUNTER_FIELDS.map((f) => [f, r[f]])) }))
      .sort((a, b) => `${a.listType}|${a.listName}|${a.variant}`.localeCompare(`${b.listType}|${b.listName}|${b.variant}`));
    data.push({ locationId, month, ...totals, breakdown: breakdown as Prisma.InputJsonValue });
  }

  let created = 0;
  if (ctx.apply) {
    for (let i = 0; i < data.length; i += CHUNK) created += (await ctx.db.campaignSnapshot.createMany({ data: data.slice(i, i + CHUNK), skipDuplicates: true })).count;
  }
  return { done: true, summary: { month, locationsWithStats: byLoc.size, alreadySnapshotted: byLoc.size - data.length, created, wouldCreate: ctx.apply ? undefined : data.length, dryRun: !ctx.apply } };
};
