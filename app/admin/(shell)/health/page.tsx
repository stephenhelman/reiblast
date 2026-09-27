import { Banner, BadgeRow, PageTitle, Section, Table } from "@/components/admin/ui";
import { fmtDenver, fmtMb, fmtUsd, last4 } from "@/lib/admin/format";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";
import { getBillingDb } from "@/lib/billing/db";
import { buildBadges, getBalancesHealth, getDataQuality, getDbSize, getJobsHealth, NEON_CRIT_PCT, NEON_WARN_PCT } from "@/lib/billing/reports/health";

export const dynamic = "force-dynamic";

const yn = (b: boolean) => (b ? <span className="text-red-300">STALE</span> : <span className="text-emerald-300">fresh</span>);

export default async function HealthPage() {
  await requireOwnerOrRedirect();
  const db = await getBillingDb();
  const [jobs, quality, balances, dbSize] = await Promise.all([getJobsHealth(db), getDataQuality(db), getBalancesHealth(db), getDbSize(db)]);
  const badges = buildBadges({ jobs, quality, balances, db: dbSize });
  const hq = balances.hqLocationId;
  const bal = (rows: typeof balances.negative) => rows.map((r) => [`${last4(r.locationId)}${r.locationId === hq ? " (HQ)" : ""}`, r.status, r.balance === null ? "—" : fmtUsd(r.balance), r.takenOn]);

  return (
    <div>
      <PageTitle sub="Read-only. All times America/Denver.">Health</PageTitle>

      {dbSize.level === "critical" && <Banner tone="bad">Database storage is at {dbSize.pct?.toFixed(0)}% of the limit (≥ {NEON_CRIT_PCT}%). Free space or raise the plan now.</Banner>}
      {dbSize.level === "warning" && <Banner tone="warn">Database storage is at {dbSize.pct?.toFixed(0)}% of the limit (≥ {NEON_WARN_PCT}%).</Banner>}
      {dbSize.level === "unset" && <Banner tone="warn">NEON_STORAGE_LIMIT_MB is not set, so the storage percentage can’t be shown.</Banner>}

      <div className="mt-6">
        <BadgeRow badges={badges} />
      </div>

      <Section title="Jobs" note="A job is stale with no successful run in 26 hours. wallet_usage also reports the rollup-vs-rows check.">
        <Table
          head={["Job", "Last start", "Last OK", "Status", "Last error", "Rollup check"]}
          rows={jobs.map((j) => [
            j.job,
            fmtDenver(j.lastStartAt),
            fmtDenver(j.lastOkAt),
            yn(j.stale),
            j.lastError ? <span className="text-red-300">{j.lastError}</span> : "—",
            j.job !== "wallet_usage" ? "—" : j.rollupMismatchCount === null ? "not recorded yet" : j.rollupMismatchCount === 0 ? <span className="text-emerald-300">0 mismatches</span> : <span className="text-red-300">{j.rollupMismatchCount} mismatches</span>,
          ])}
        />
        {jobs.find((j) => j.rollupMismatches.length > 0) && (
          <pre className="max-h-64 overflow-auto border-t border-border-default px-4 py-3 text-xs text-white/70">{JSON.stringify(jobs.find((j) => j.rollupMismatches.length > 0)?.rollupMismatches, null, 1)}</pre>
        )}
      </Section>

      <Section title="Unclassified ledger rows" note={`${quality.unclassifiedCount} total${quality.unclassifiedCount > quality.unclassified.length ? ` — newest ${quality.unclassified.length} shown` : ""}.`}>
        <Table
          head={["GHL transaction", "Occurred", "Status", "Amount", "Provider"]}
          rows={quality.unclassified.map((r) => [r.ghlTransactionId, fmtDenver(r.occurredAt), r.status, fmtUsd(r.amount), r.provider])}
          empty="None — every ledger row is classified."
        />
      </Section>

      <Section title="Unmatched ledger rows" note={`${quality.unmatchedTotal} rows with no member account (ghlAccountId null), by classification.`}>
        <Table head={["Classification", "Rows"]} rows={quality.unmatched.map((u) => [u.classification, u.count])} empty="None — every ledger row is matched." />
      </Section>

      <Section
        title="GHL events"
        note={`Last 24 h: ${quality.last24h.total} received · ${quality.last24h.processed} processed · ${quality.last24h.pending} pending · ${quality.last24h.failed} failed. Failed = unprocessed with attempts ≥ 5 or a recorded error.`}
      >
        <Table
          head={["Event", "Source", "Transaction", "Attempts", "Received", "Last error"]}
          rows={quality.failedEvents.map((e) => [last4(e.id), e.source, e.externalId ?? "—", e.attempts, fmtDenver(e.receivedAt), e.lastError ?? "—"])}
          empty="No failed events."
        />
      </Section>

      <Section title="Wallet balances" note={`Latest snapshot per location (${balances.total} locations, latest day ${balances.latestDay ?? "—"}).`}>
        <div className="px-4 pt-3 text-xs uppercase tracking-wide text-white/40">Negative ({balances.negative.length})</div>
        <Table head={["Location", "Status", "Balance", "Snapshot day"]} rows={bal(balances.negative)} empty="None." />
        <div className="border-t border-border-default px-4 pt-3 text-xs uppercase tracking-wide text-white/40">Unavailable ({balances.unavailable.length})</div>
        <Table head={["Location", "Status", "Balance", "Snapshot day"]} rows={bal(balances.unavailable)} empty="None." />
        <div className="border-t border-border-default px-4 pt-3 text-xs uppercase tracking-wide text-white/40">Errors ({balances.errors.length})</div>
        <Table head={["Location", "Status", "Balance", "Snapshot day"]} rows={bal(balances.errors)} empty="None." />
      </Section>

      <Section title="Database" note="Neon storage is project-wide — every branch counts toward the plan limit; this figure is this branch only.">
        <p className="px-4 py-3 text-sm text-white/80">
          {fmtMb(dbSize.usedMb)} used{dbSize.limitMb ? ` of ${fmtMb(dbSize.limitMb)} (${dbSize.pct?.toFixed(1)}%)` : " — NEON_STORAGE_LIMIT_MB not set"}
        </p>
        <Table head={["Largest tables", "Size", "≈ Rows"]} rows={dbSize.largestTables.map((t) => [t.name, fmtMb(t.mb), t.approxRows.toLocaleString("en-US")])} />
      </Section>
    </div>
  );
}
