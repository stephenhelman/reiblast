// Admin Compare (/admin/members/compare) data layer — READ-ONLY, CLIENT-SAFE.
// This surface is screen-shared WITH MEMBERS, so it shows USAGE ONLY: no
// cost, no margin, no revenue, no vendor spend, for either member. NEVER
// import lib/adminMoney.ts here and NEVER read ApiCall.costCents. The only
// ledger read allowed is LedgerEntry.allowanceCovered — the allowance-vs-
// credit USAGE split (a boolean/count, not a dollar figure).
//
// Runs are counted off LedgerEntry consumption rows (kind:'consumption'),
// scoped by the ledger's own toolId — same per-mark join the acq/dispo split
// needs, and it keeps "runs", "allowance used", "% on credits", and the
// chart series all reading from one source instead of ToolUse and
// LedgerEntry drifting against each other.

import { PrismaClient, TierLevel } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getBrandAssets } from "@/lib/brandAssets";
import { brandSlugFor } from "@/lib/brandSlug";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type CompareMemberInfo = {
  id: string;
  name: string;
  locationId: string;
};

export type CompareStat = { label: string; a: string; b: string };

export type CompareToolBlock = {
  slug: string;
  name: string;
  wordmark: string;
  live: boolean;
  stats: CompareStat[];
  seriesA: { date: string; runs: number }[];
  seriesB: { date: string; runs: number }[];
};

export type CompareData = {
  memberA: CompareMemberInfo;
  memberB: CompareMemberInfo;
  rangeDays: number;
  tools: CompareToolBlock[];
};

export type MemberSearchResult = { id: string; name: string; locationId: string };

/** Typeahead search for the A/B member pickers — non-admin users only. */
export async function searchComparableMembers(query: string, db: PrismaClient = defaultPrisma): Promise<MemberSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const users = await db.user.findMany({
    where: {
      role: { not: "admin" },
      OR: [{ name: { contains: q, mode: "insensitive" } }, { ghlLocationId: { contains: q, mode: "insensitive" } }],
    },
    select: { id: true, name: true, ghlLocationId: true, email: true },
    take: 8,
    orderBy: { createdAt: "desc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email, locationId: u.ghlLocationId ?? "—" }));
}

async function loadMemberBasics(userId: string, db: PrismaClient) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { subscriptions: { where: { status: "active" }, include: { tier: { include: { feature: true } } } } },
  });
  if (!user || user.role === "admin") return null;
  return user;
}

export async function getAdminCompare(
  idA: string,
  idB: string,
  rangeDays: number = 90,
  db: PrismaClient = defaultPrisma,
): Promise<CompareData | null> {
  if (idA === idB) return null;
  const now = new Date();
  const rangeStart = new Date(now.getTime() - rangeDays * DAY_MS);

  const [userA, userB, tools] = await Promise.all([loadMemberBasics(idA, db), loadMemberBasics(idB, db), db.tool.findMany({ include: { feature: true } })]);
  if (!userA || !userB) return null;

  const ledger = await db.ledgerEntry.findMany({
    where: {
      userId: { in: [idA, idB] },
      kind: "consumption",
      toolId: { not: null },
      createdAt: { gte: rangeStart, lte: now },
    },
    select: { userId: true, toolId: true, createdAt: true, allowanceCovered: true },
  });

  const ledgerByTool = new Map<string, typeof ledger>();
  for (const l of ledger) {
    if (!l.toolId) continue;
    const arr = ledgerByTool.get(l.toolId) ?? [];
    arr.push(l);
    ledgerByTool.set(l.toolId, arr);
  }

  const activeSubByFeatureSlug = (user: NonNullable<typeof userA>) => {
    const map = new Map<string, { level: TierLevel; allowance: number | null }>();
    for (const s of user.subscriptions) {
      map.set(s.tier.feature.slug, { level: s.tier.level, allowance: s.tier.allowance });
    }
    return map;
  };
  const subsA = activeSubByFeatureSlug(userA);
  const subsB = activeSubByFeatureSlug(userB);

  const weeks = Math.max(1, Math.ceil(rangeDays / 7));

  function statsFor(rows: typeof ledger, userId: string) {
    const own = rows.filter((r) => r.userId === userId);
    const total = own.length;
    const creditCovered = own.filter((r) => r.allowanceCovered === false).length;
    const pctOnCredits = total > 0 ? Math.round((creditCovered / total) * 100) : 0;
    const avgPerWeek = total / weeks;
    const series: { date: string; runs: number }[] = Array.from({ length: weeks }, (_, i) => ({
      date: new Date(rangeStart.getTime() + i * WEEK_MS).toISOString().slice(0, 10),
      runs: 0,
    }));
    for (const r of own) {
      const idx = Math.min(weeks - 1, Math.floor((r.createdAt.getTime() - rangeStart.getTime()) / WEEK_MS));
      if (idx >= 0 && idx < series.length) series[idx].runs += 1;
    }
    return { total, creditCovered, pctOnCredits, avgPerWeek, series };
  }

  const toolBlocks: CompareToolBlock[] = [];
  for (const t of tools) {
    const rows = ledgerByTool.get(t.id) ?? [];
    const a = statsFor(rows, idA);
    const b = statsFor(rows, idB);
    if (a.total === 0 && b.total === 0) continue;

    const allowanceA = subsA.get(t.feature.slug)?.allowance ?? null;
    const allowanceB = subsB.get(t.feature.slug)?.allowance ?? null;
    const usedA = allowanceA !== null ? Math.min(a.total, allowanceA) : a.total;
    const usedB = allowanceB !== null ? Math.min(b.total, allowanceB) : b.total;

    toolBlocks.push({
      slug: t.slug,
      name: t.name,
      wordmark: getBrandAssets(brandSlugFor(t.slug)).wordmark,
      live: t.active,
      stats: [
        { label: "Runs this period", a: String(a.total), b: String(b.total) },
        { label: "Allowance used", a: `${usedA} / ${allowanceA ?? "—"}`, b: `${usedB} / ${allowanceB ?? "—"}` },
        { label: "% on credits", a: `${a.pctOnCredits}%`, b: `${b.pctOnCredits}%` },
        { label: "Avg / week", a: a.avgPerWeek.toFixed(1), b: b.avgPerWeek.toFixed(1) },
      ],
      seriesA: a.series,
      seriesB: b.series,
    });
  }
  // Sort by rank to keep the ordering stable and useful — most used first.
  toolBlocks.sort((x, y) => {
    const xTotal = Number(x.stats[0].a) + Number(x.stats[0].b);
    const yTotal = Number(y.stats[0].a) + Number(y.stats[0].b);
    return yTotal - xTotal;
  });

  return {
    memberA: { id: userA.id, name: userA.name ?? userA.email, locationId: userA.ghlLocationId ?? "—" },
    memberB: { id: userB.id, name: userB.name ?? userB.email, locationId: userB.ghlLocationId ?? "—" },
    rangeDays,
    tools: toolBlocks,
  };
}
