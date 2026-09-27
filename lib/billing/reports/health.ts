import type { BillingState, PrismaClient } from "@prisma/client";
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

export type BalanceLevel = "alert" | "warning" | "info";
export type BalanceClass = { level: BalanceLevel; reason: string } | null;
type Snap = { status: string; balance: string | null } | null;

/**
 * State-aware balance rules (member accounts only). `snap` is the latest snapshot, or null if none exists.
 *   trial / active / payment_failed : unavailable|error → ALERT "expected a wallet"; negative → WARNING
 *   paused                          : negative → INFO (expected); unavailable/error → not shown
 *   inactive / churned              : not shown
 *   billingState null               : ALERT "state not seeded", whatever the balance (even with no snapshot)
 * (buildBalanceAlerts only applies these to member accounts that HAVE a locationId — accounts still onboarding are not shown.)
 */
export function classifyBalance(state: BillingState | null, snap: Snap): BalanceClass {
  if (state === null) return { level: "alert", reason: "state not seeded" };
  const negative = !!snap && snap.status === "ok" && snap.balance !== null && Number(snap.balance) < 0;
  switch (state) {
    case "trial":
    case "active":
    case "payment_failed":
      if (snap && (snap.status === "unavailable" || snap.status === "error")) return { level: "alert", reason: `expected a wallet (${snap.status})` };
      return negative ? { level: "warning", reason: "negative balance" } : null;
    case "paused":
      return negative ? { level: "info", reason: "negative while paused (expected)" } : null;
    default:
      return null; // inactive, churned
  }
}

export type BalanceRow = { locationId: string; takenOn: string; status: string; balance: string | null; locationName: string | null; businessName: string | null; billingState: BillingState | null | "n/a" };
/** One alert per MEMBER account that has a location. */
export type BalanceAlert = BalanceRow & { accountId: string; level: BalanceLevel; reason: string };
export type BalancesHealth = {
  total: number;
  latestDay: string | null;
  hqLocationId: string | null;
  /** Member accounts only, sorted alert → warning → info, then most negative first. */
  alerts: BalanceAlert[];
  counts: Record<BalanceLevel, number>;
  /** Every latest snapshot in every state (incl. HQ, whose billingState is "n/a"), for reference. */
  all: BalanceRow[];
};

const LEVEL_ORDER: Record<BalanceLevel, number> = { alert: 0, warning: 1, info: 2 };

/**
 * Pure: combine member accounts with their latest snapshots into alerts. Evaluated per MEMBER account, not per snapshot.
 * Accounts without a locationId (still onboarding, no wallet yet) are never alerted — not even when billingState is null.
 */
export function buildBalanceAlerts(
  members: { accountId: string; locationId: string | null; billingState: BillingState | null; locationName: string | null; businessName: string | null }[],
  snapshots: Map<string, { takenOn: string; status: string; balance: string | null }>,
): BalanceAlert[] {
  const out: BalanceAlert[] = [];
  for (const m of members) {
    if (!m.locationId) continue;
    const snap = snapshots.get(m.locationId) ?? null;
    const c = classifyBalance(m.billingState, snap);
    if (!c) continue;
    out.push({ accountId: m.accountId, locationId: m.locationId, takenOn: snap?.takenOn ?? "—", status: snap?.status ?? "no snapshot", balance: snap?.balance ?? null, locationName: m.locationName, businessName: m.businessName, billingState: m.billingState, ...c });
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || Number(a.balance ?? 0) - Number(b.balance ?? 0));
}

export async function getBalancesHealth(db: PrismaClient): Promise<BalancesHealth> {
  const rows = await db.$queryRaw<{ locationId: string; takenOn: Date; status: string; balance: { toString(): string } | null }[]>`
    SELECT DISTINCT ON ("locationId") "locationId", "takenOn", "status", "balance"
    FROM "WalletBalanceSnapshot" ORDER BY "locationId", "takenOn" DESC`;
  const snaps = rows.map((r) => ({ locationId: r.locationId, takenOn: r.takenOn.toISOString().slice(0, 10), status: r.status, balance: r.balance === null ? null : r.balance.toString() }));
  const snapBy = new Map(snaps.map((r) => [r.locationId, r]));

  // Member accounts that have a location (accounts still onboarding have no wallet and are not alerted).
  const memberRows = await db.ghlAccount.findMany({
    where: { accountType: "member", locationId: { not: null } },
    select: { id: true, locationId: true, billingState: true, locationName: true, user: { select: { businessName: true } } },
  });
  const members = memberRows.map((m) => ({ accountId: m.id, locationId: m.locationId, billingState: m.billingState, locationName: m.locationName, businessName: m.user?.businessName ?? null }));
  const memberBy = new Map(members.filter((m) => m.locationId).map((m) => [m.locationId as string, m]));

  const alerts = buildBalanceAlerts(members, snapBy);
  const all: BalanceRow[] = snaps
    .map((r) => {
      const m = memberBy.get(r.locationId);
      return { ...r, locationName: m?.locationName ?? null, businessName: m?.businessName ?? null, billingState: (m ? m.billingState : "n/a") as BalanceRow["billingState"] };
    })
    .sort((a, b) => Number(a.balance ?? Infinity) - Number(b.balance ?? Infinity));
  return {
    total: snaps.length,
    latestDay: snaps.reduce<string | null>((m, r) => (m === null || r.takenOn > m ? r.takenOn : m), null),
    hqLocationId: process.env.GHL_HQ_LOCATION_ID ?? null,
    alerts,
    counts: { alert: alerts.filter((a) => a.level === "alert").length, warning: alerts.filter((a) => a.level === "warning").length, info: alerts.filter((a) => a.level === "info").length },
    all,
  };
}

// ── usage on non-active accounts ────────────────────────────────────────────

export const INACTIVE_STATES: BillingState[] = ["paused", "inactive", "churned"];
const REPORTING_TZ = "America/Denver";

/** YYYY-MM-DD of `now` in Denver. */
export function denverDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** First Denver calendar day of the trailing `days`-day window that ends today (today included): days=7 → today and the 6 before. */
export function denverWindowStart(now: Date, days = 7): string {
  return new Date(Date.parse(`${denverDate(now)}T00:00:00Z`) - (days - 1) * 864e5).toISOString().slice(0, 10);
}

export type InactiveUsageRow = { locationId: string; locationName: string | null; businessName: string | null; billingState: BillingState; cost: string; lastUsageAt: Date; charges: number };

/**
 * Member accounts in paused/inactive/churned with any wallet CHARGE in the last 7 Denver days. Reads WalletTransaction
 * (the row-level evidence behind UsageRollup — the two reconcile exactly) because Denver-day bucketing needs
 * settlementTime; UsageRollup.day is a UTC day. Charges are negative amounts; cost is shown positive.
 */
export async function getInactiveUsage(db: PrismaClient, now = new Date()): Promise<{ windowStart: string; rows: InactiveUsageRow[] }> {
  const windowStart = denverWindowStart(now, 7);
  const accounts = await db.ghlAccount.findMany({
    where: { accountType: "member", billingState: { in: INACTIVE_STATES }, locationId: { not: null } },
    select: { locationId: true, billingState: true, locationName: true, user: { select: { businessName: true } } },
  });
  if (accounts.length === 0) return { windowStart, rows: [] };
  const byLoc = new Map(accounts.map((a) => [a.locationId as string, a]));
  const usage = await db.$queryRaw<{ scopeKey: string; cost: string; lastAt: Date; charges: bigint }[]>`
    SELECT "scopeKey", (-SUM("amount"))::text AS cost, MAX("settlementTime") AS "lastAt", COUNT(*) AS charges
    FROM "WalletTransaction"
    WHERE "scopeKey" = ANY(${[...byLoc.keys()]}) AND "amount" < 0
      AND ("settlementTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date >= ${windowStart}::date
    GROUP BY "scopeKey"`;
  const rows = usage
    .map((u) => {
      const a = byLoc.get(u.scopeKey) as NonNullable<ReturnType<typeof byLoc.get>>;
      return { locationId: u.scopeKey, locationName: a.locationName, businessName: a.user?.businessName ?? null, billingState: a.billingState as BillingState, cost: u.cost, lastUsageAt: u.lastAt, charges: Number(u.charges) };
    })
    .sort((x, y) => Number(y.cost) - Number(x.cost));
  return { windowStart, rows };
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
  balances: Pick<BalancesHealth, "counts">;
  inactiveUsage: { rows: unknown[] };
  db: { level: DbSizeLevel; pct: number | null };
}): Badge[] {
  const stale = x.jobs.filter((j) => j.stale).length;
  const errored = x.jobs.filter((j) => j.lastError).length;
  const mismatch = x.jobs.find((j) => j.job === "wallet_usage")?.rollupMismatchCount ?? null;
  const { alert, warning } = x.balances.counts;
  const inactive = x.inactiveUsage.rows.length;
  return [
    { key: "jobs", label: "Jobs", value: stale || errored ? `${stale} stale · ${errored} erroring` : "all fresh", tone: stale || errored ? "bad" : "ok" },
    { key: "rollup", label: "Rollup check", value: mismatch === null ? "not recorded yet" : `${mismatch} mismatches`, tone: mismatch === null ? "warn" : mismatch > 0 ? "bad" : "ok" },
    { key: "unclassified", label: "Unclassified", value: String(x.quality.unclassifiedCount), tone: x.quality.unclassifiedCount > 0 ? "warn" : "ok" },
    { key: "unmatched", label: "Unmatched", value: String(x.quality.unmatchedTotal), tone: x.quality.unmatchedTotal > 0 ? "warn" : "ok" },
    { key: "events", label: "Failed events", value: String(x.quality.failedEventCount), tone: x.quality.failedEventCount > 0 ? "bad" : "ok" },
    { key: "balances", label: "Balance alerts", value: `${alert} alert · ${warning} warning`, tone: alert > 0 ? "bad" : warning > 0 ? "warn" : "ok" },
    { key: "inactive-usage", label: "Usage on non-active", value: String(inactive), tone: inactive > 0 ? "bad" : "ok" },
    { key: "db", label: "Database", value: x.db.pct === null ? "limit not set" : `${x.db.pct.toFixed(0)}% of limit`, tone: x.db.level === "critical" ? "bad" : x.db.level === "warning" || x.db.level === "unset" ? "warn" : "ok" },
  ];
}
