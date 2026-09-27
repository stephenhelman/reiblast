import type { PrismaClient } from "@prisma/client";
import { getJobHealth, type JobHealth } from "../jobHealth";

/** Read-only queries for the admin Health/Overview views. Every function takes the db client (getBillingDb() in the app). */

export const NEON_WARN_PCT = 70;
export const NEON_CRIT_PCT = 90;

// ── jobs ────────────────────────────────────────────────────────────────────

export type JobsHealth = JobHealth & {
  /** wallet_usage only: null = the last run predates the rollup-vs-rows check (no check recorded). */
  rollupMismatchCount: number | null;
  rollupMismatches: unknown[];
};

/** Pulls the mismatch count/details out of a wallet_usage lastSummary (nightly shape or single-window shape). */
export function parseRollupCheck(summary: unknown): { count: number | null; mismatches: unknown[] } {
  const s = summary as { mismatchCount?: unknown; rollupCheck?: unknown; results?: unknown } | null;
  if (!s || typeof s !== "object") return { count: null, mismatches: [] };
  if (Array.isArray(s.results)) {
    let count = 0;
    let seen = false;
    const mismatches: unknown[] = [];
    for (const r of s.results as { rollupCheck?: { mismatchCount?: number; mismatches?: unknown[] } | string }[]) {
      if (r && typeof r.rollupCheck === "object" && typeof r.rollupCheck.mismatchCount === "number") {
        seen = true;
        count += r.rollupCheck.mismatchCount;
        mismatches.push(...(r.rollupCheck.mismatches ?? []));
      }
    }
    return { count: seen ? count : null, mismatches };
  }
  const rc = s.rollupCheck as { mismatchCount?: number; mismatches?: unknown[] } | undefined;
  if (rc && typeof rc === "object" && typeof rc.mismatchCount === "number") return { count: rc.mismatchCount, mismatches: rc.mismatches ?? [] };
  return { count: null, mismatches: [] };
}

export async function getJobsHealth(db: PrismaClient, now = new Date()): Promise<JobsHealth[]> {
  const jobs = await getJobHealth(db, now);
  const usage = await db.jobRun.findUnique({ where: { job: "wallet_usage" }, select: { lastSummary: true } });
  const check = parseRollupCheck(usage?.lastSummary);
  return jobs.map((j) => (j.job === "wallet_usage" ? { ...j, rollupMismatchCount: check.count, rollupMismatches: check.mismatches } : { ...j, rollupMismatchCount: null, rollupMismatches: [] }));
}

// ── data quality ────────────────────────────────────────────────────────────

export type LedgerRowLite = { ghlTransactionId: string; occurredAt: Date; status: string; amount: string; provider: string; classification: string };

export async function getDataQuality(db: PrismaClient, now = new Date(), listLimit = 100) {
  const [unclassifiedCount, unclassified, unmatchedByClass, failedEvents, recent] = await Promise.all([
    db.billingLedgerEntry.count({ where: { classification: "unclassified" } }),
    db.billingLedgerEntry.findMany({
      where: { classification: "unclassified" },
      orderBy: { occurredAt: "desc" },
      take: listLimit,
      select: { ghlTransactionId: true, occurredAt: true, status: true, amount: true, provider: true, classification: true },
    }),
    db.billingLedgerEntry.groupBy({ by: ["classification"], where: { ghlAccountId: null }, _count: { _all: true } }),
    db.ghlEvent.findMany({
      where: { processedAt: null, OR: [{ attempts: { gte: 5 } }, { lastError: { not: null } }] },
      orderBy: { receivedAt: "desc" },
      take: listLimit,
      select: { id: true, source: true, externalId: true, attempts: true, lastError: true, receivedAt: true },
    }),
    db.ghlEvent.findMany({ where: { receivedAt: { gte: new Date(now.getTime() - 864e5) } }, select: { processedAt: true, attempts: true, lastError: true } }),
  ]);
  const failedCount = await db.ghlEvent.count({ where: { processedAt: null, OR: [{ attempts: { gte: 5 } }, { lastError: { not: null } }] } });
  return {
    unclassifiedCount,
    unclassified: unclassified.map((r) => ({ ...r, amount: r.amount.toFixed(6) })) as LedgerRowLite[],
    unmatched: unmatchedByClass.map((g) => ({ classification: g.classification, count: g._count._all })).sort((a, b) => b.count - a.count),
    unmatchedTotal: unmatchedByClass.reduce((n, g) => n + g._count._all, 0),
    failedEventCount: failedCount,
    failedEvents,
    last24h: {
      total: recent.length,
      processed: recent.filter((e) => e.processedAt).length,
      failed: recent.filter((e) => !e.processedAt && (e.attempts >= 5 || e.lastError)).length,
      pending: recent.filter((e) => !e.processedAt && e.attempts < 5 && !e.lastError).length,
    },
  };
}

// ── balances ────────────────────────────────────────────────────────────────

export type BalanceRow = { locationId: string; takenOn: string; status: string; balance: string | null; locationName: string | null; businessName: string | null };
export type BalancesHealth = { total: number; latestDay: string | null; negative: BalanceRow[]; unavailable: BalanceRow[]; errors: BalanceRow[]; hqLocationId: string | null };

/** Latest snapshot per location (member locations + HQ), split into negative / unavailable / error. */
export async function getBalancesHealth(db: PrismaClient): Promise<BalancesHealth> {
  const rows = await db.$queryRaw<{ locationId: string; takenOn: Date; status: string; balance: { toString(): string } | null }[]>`
    SELECT DISTINCT ON ("locationId") "locationId", "takenOn", "status", "balance"
    FROM "WalletBalanceSnapshot" ORDER BY "locationId", "takenOn" DESC`;
  // Names for display (member accounts only; HQ is labelled by the helper from GHL_HQ_LOCATION_ID).
  const accounts = await db.ghlAccount.findMany({
    where: { accountType: "member", locationId: { in: rows.map((r) => r.locationId) } },
    select: { locationId: true, locationName: true, user: { select: { businessName: true } } },
  });
  const nameBy = new Map(accounts.map((a) => [a.locationId as string, a]));
  const lite: BalanceRow[] = rows.map((r) => ({
    locationId: r.locationId,
    takenOn: r.takenOn.toISOString().slice(0, 10),
    status: r.status,
    balance: r.balance === null ? null : r.balance.toString(),
    locationName: nameBy.get(r.locationId)?.locationName ?? null,
    businessName: nameBy.get(r.locationId)?.user?.businessName ?? null,
  }));
  return {
    total: lite.length,
    latestDay: lite.reduce<string | null>((m, r) => (m === null || r.takenOn > m ? r.takenOn : m), null),
    negative: lite.filter((r) => r.status === "ok" && r.balance !== null && Number(r.balance) < 0).sort((a, b) => Number(a.balance) - Number(b.balance)),
    unavailable: lite.filter((r) => r.status === "unavailable"),
    errors: lite.filter((r) => r.status === "error"),
    hqLocationId: process.env.GHL_HQ_LOCATION_ID ?? null,
  };
}

// ── database size ───────────────────────────────────────────────────────────

export type DbSizeLevel = "ok" | "warning" | "critical" | "unset";
export function dbSizeLevel(usedMb: number, limitMb: number | null): { pct: number | null; level: DbSizeLevel } {
  if (!limitMb || limitMb <= 0) return { pct: null, level: "unset" };
  const pct = (usedMb / limitMb) * 100;
  return { pct, level: pct >= NEON_CRIT_PCT ? "critical" : pct >= NEON_WARN_PCT ? "warning" : "ok" };
}

export async function getDbSize(db: PrismaClient, env: Record<string, string | undefined> = process.env) {
  const [size] = await db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
  const tables = await db.$queryRaw<{ name: string; bytes: bigint; rows: bigint }[]>`
    SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, c.reltuples::bigint AS rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5`;
  const usedMb = Number(size.bytes) / 1024 / 1024;
  const limit = Number(env.NEON_STORAGE_LIMIT_MB);
  const limitMb = Number.isFinite(limit) && limit > 0 ? limit : null;
  return { usedMb, limitMb, ...dbSizeLevel(usedMb, limitMb), largestTables: tables.map((t) => ({ name: t.name, mb: Number(t.bytes) / 1024 / 1024, approxRows: Number(t.rows) })) };
}

// ── overview ────────────────────────────────────────────────────────────────

/** Member accounts only — internal accounts (owner/HQ) never count. billingState null = "not yet seeded". */
export async function getMemberOverview(db: PrismaClient) {
  const [byState, legacy, strikes] = await Promise.all([
    db.ghlAccount.groupBy({ by: ["billingState"], where: { accountType: "member" }, _count: { _all: true } }),
    db.ghlAccount.count({ where: { accountType: "member", legacyUnreconciled: true } }),
    db.user.groupBy({ by: ["warningCount"], where: { warningCount: { gt: 0 }, NOT: { ghlAccount: { is: { accountType: "internal" } } } }, _count: { _all: true }, orderBy: { warningCount: "asc" } }),
  ]);
  return {
    billingStates: byState.map((g) => ({ state: g.billingState ?? "not yet seeded", count: g._count._all })).sort((a, b) => b.count - a.count),
    memberTotal: byState.reduce((n, g) => n + g._count._all, 0),
    legacyUnreconciled: legacy,
    // Live (pre-cutover): User.warningCount is what the running app enforces today; it is not the GhlAccount strike count.
    strikeCounts: strikes.map((s) => ({ warningCount: s.warningCount, users: s._count._all })),
  };
}

// ── summary badges ──────────────────────────────────────────────────────────

export type Badge = { key: string; label: string; value: string; tone: "ok" | "warn" | "bad" };

export function buildBadges(x: {
  jobs: JobsHealth[];
  quality: { unclassifiedCount: number; unmatchedTotal: number; failedEventCount: number };
  balances: BalancesHealth;
  db: { level: DbSizeLevel; pct: number | null };
}): Badge[] {
  const stale = x.jobs.filter((j) => j.stale).length;
  const errored = x.jobs.filter((j) => j.lastError).length;
  const mismatch = x.jobs.find((j) => j.job === "wallet_usage")?.rollupMismatchCount ?? null;
  return [
    { key: "jobs", label: "Jobs", value: stale || errored ? `${stale} stale · ${errored} erroring` : "all fresh", tone: stale || errored ? "bad" : "ok" },
    { key: "rollup", label: "Rollup check", value: mismatch === null ? "not recorded yet" : `${mismatch} mismatches`, tone: mismatch === null ? "warn" : mismatch > 0 ? "bad" : "ok" },
    { key: "unclassified", label: "Unclassified", value: String(x.quality.unclassifiedCount), tone: x.quality.unclassifiedCount > 0 ? "warn" : "ok" },
    { key: "unmatched", label: "Unmatched", value: String(x.quality.unmatchedTotal), tone: x.quality.unmatchedTotal > 0 ? "warn" : "ok" },
    { key: "events", label: "Failed events", value: String(x.quality.failedEventCount), tone: x.quality.failedEventCount > 0 ? "bad" : "ok" },
    { key: "balances", label: "Negative balances", value: `${x.balances.negative.length}`, tone: x.balances.negative.length > 0 ? "bad" : "ok" },
    { key: "db", label: "Database", value: x.db.pct === null ? "limit not set" : `${x.db.pct.toFixed(0)}% of limit`, tone: x.db.level === "critical" ? "bad" : x.db.level === "warning" || x.db.level === "unset" ? "warn" : "ok" },
  ];
}
