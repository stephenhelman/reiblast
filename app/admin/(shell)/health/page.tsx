import AccountLabel from "@/components/admin/AccountLabel";
import { Banner, BadgeRow, PageTitle, Section, Table } from "@/components/admin/ui";
import { fmtDenver, fmtDenverDate, fmtMb, fmtUsd, last4 } from "@/lib/admin/format";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";
import { getBillingDb } from "@/lib/billing/db";
import { buildBadges, getBalancesHealth, getDataQuality, getDbSize, getDunningShadow, getInactiveUsage, getIntentsHealth, getJobsHealth, getRecentGhlEvents, getUnpaidSubscriptions, NEON_CRIT_PCT, NEON_WARN_PCT, type BalanceLevel } from "@/lib/billing/reports/health";

export const dynamic = "force-dynamic";

const LEVEL_STYLE: Record<BalanceLevel, string> = { alert: "text-red-300", warning: "text-gold", info: "text-white/50" };
const stateCell = (s: string | null) => (s === null ? <span className="text-red-300">not seeded</span> : s === "n/a" ? "—" : s);

const yn = (b: boolean) => (b ? <span className="text-red-300">STALE</span> : <span className="text-emerald-300">fresh</span>);

export default async function HealthPage() {
  await requireOwnerOrRedirect();
  const db = await getBillingDb();
  const [jobs, quality, balances, dbSize, inactiveUsage, dunning, intents, ghlEvents, unpaid] = await Promise.all([getJobsHealth(db), getDataQuality(db), getBalancesHealth(db), getDbSize(db), getInactiveUsage(db), getDunningShadow(db), getIntentsHealth(db), getRecentGhlEvents(db), getUnpaidSubscriptions(db)]);
  const badges = buildBadges({ jobs, quality, balances, inactiveUsage, db: dbSize });
  const label = (r: { locationId: string; locationName: string | null; businessName: string | null }) => <AccountLabel locationId={r.locationId} locationName={r.locationName} businessName={r.businessName} />;

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

      <Section
        title="Balance alerts"
        note={`Member accounts only, by billing state. ${balances.counts.alert} alert · ${balances.counts.warning} warning · ${balances.counts.info} info. Trial/active/payment_failed: unavailable or error is an ALERT (a wallet is expected), negative is a WARNING. Paused: negative is INFO. Inactive/churned are not alerted. Null billing state is always an ALERT.`}
      >
        <Table
          head={["Level", "Location", "State", "Reason", "Snapshot", "Balance", "Day"]}
          rows={balances.alerts.map((a) => [
            <span key="l" className={`font-semibold uppercase ${LEVEL_STYLE[a.level]}`}>{a.level}</span>,
            label(a),
            stateCell(a.billingState),
            a.reason,
            a.status,
            a.balance === null ? "—" : fmtUsd(a.balance),
            a.takenOn,
          ])}
          empty="No balance alerts."
        />
      </Section>

      <Section
        title="Usage on non-active accounts"
        note={`Paused / inactive / churned member accounts with wallet charges since ${inactiveUsage.windowStart} (last 7 days, America/Denver). ${inactiveUsage.rows.length ? "ALERT — these accounts should not be incurring usage." : ""}`}
      >
        <Table
          head={["Location", "State", "7-day cost", "Charges", "Last usage"]}
          rows={inactiveUsage.rows.map((r) => [label(r), r.billingState, <span key="c" className="text-red-300">{fmtUsd(r.cost)}</span>, r.charges, fmtDenverDate(r.lastUsageAt)])}
          empty="None — no usage on paused, inactive or churned accounts."
        />
      </Section>

      <Section title="All balances" note={`Latest snapshot per location, every state (${balances.total} locations, latest day ${balances.latestDay ?? "—"}). Reference only — alerts are above. HQ is not a member account.`}>
        <details>
          <summary className="cursor-pointer px-4 py-3 text-sm text-gold">Show all {balances.total} balances</summary>
          <Table
            head={["Location", "State", "Status", "Balance", "Day"]}
            rows={balances.all.map((r) => [label(r), stateCell(r.billingState), r.status, r.balance === null ? "—" : fmtUsd(r.balance), r.takenOn])}
          />
        </details>
      </Section>

      <Section
        title="Dunning (shadow)"
        note={`What the billing state engine WOULD do — it records decisions only; nothing here pauses, resumes or moves a stage. Decisions recorded: ${Object.entries(dunning.byMode).map(([m, n]) => `${m} ${n}`).join(" · ") || "none yet"}. The shadow projection (latest SHADOW decision per account) differs from GhlAccount.billingState on ${dunning.diff.differs} of ${dunning.diff.projectedCount} accounts (${dunning.diff.differsSeeded} seeded, ${dunning.diff.differsUnseeded} not yet seeded). “est.” marks a balance reconstructed by replay.`}
      >
        {dunning.shadowErrors.count > 0 && <p className="px-4 pt-3 text-sm text-red-300">Shadow errors recorded: {dunning.shadowErrors.count} — last: {dunning.shadowErrors.last}</p>}
        {dunning.diff.breakdown.length > 0 && (
          <Table head={["Shadow-projected", "GhlAccount.billingState", "Accounts"]} rows={dunning.diff.breakdown.map((b) => [b.projected, b.actual, b.n])} />
        )}
        <div className="border-t border-border-default px-4 pt-3 text-xs uppercase tracking-wide text-white/40">Last 50 shadow decisions</div>
        <Table
          head={["When (Denver)", "Account", "Event", "State", "Strikes", "Reason", "Mode"]}
          rows={dunning.recent.map((r) => [
            fmtDenver(r.eventAt),
            <AccountLabel key={r.id} locationId={r.ghlAccount.locationId} locationName={r.ghlAccount.locationName} businessName={r.ghlAccount.user?.businessName} />,
            r.eventKind.replace(/_/g, " "),
            `${r.fromState ?? "—"} → ${r.toState ?? "—"}${r.pauseReason ? ` (${r.pauseReason})` : ""}`,
            `${r.fromStrikes} → ${r.toStrikes}`,
            <span key="w" className="text-white/70">{r.reason}{r.walletBalance !== null && <span className="ml-2 text-xs text-white/40">bal {fmtUsd(r.walletBalance)}{r.balanceEstimated ? " est." : ""}</span>}</span>,
            r.mode,
          ])}
          empty="No shadow decisions recorded yet."
        />
        <div className="border-t border-border-default px-4 pt-3 text-xs uppercase tracking-wide text-white/40">Replay analysis (history replayed through the engine — kept separate, never feeds the shadow projection)</div>
        <p className="px-4 pt-2 text-sm text-white/60">
          {dunning.replayDiff.projectedCount === 0
            ? "No replay has been applied."
            : `Replay end-state differs from GhlAccount.billingState on ${dunning.replayDiff.differs} of ${dunning.replayDiff.projectedCount} accounts. Replay sees only ledger payments (not cancellations, manual moves or pre-June history), and its balances are estimates.`}
        </p>
        {dunning.replayDiff.breakdown.length > 0 && <Table head={["Replay end-state", "GhlAccount.billingState", "Accounts"]} rows={dunning.replayDiff.breakdown.map((b) => [b.projected, b.actual, b.n])} />}
      </Section>

      <Section
        title="GHL intents (outbox)"
        note={`Pipeline/field updates the engine wants made in GHL. In shadow mode (or for an account not allowlisted for live) they are recorded as "skipped_shadow" and NOTHING is sent. Pending ${intents.counts.pending} · sent ${intents.counts.sent} · failed ${intents.counts.failed} · skipped_shadow ${intents.counts.skipped_shadow}. Last 20:`}
      >
        <Table
          head={["Created (Denver)", "Account", "Pipeline", "Kind", "Stage", "Status", "Attempts", "Error"]}
          rows={intents.last.map((i) => [
            fmtDenver(i.createdAt),
            i.label ? <AccountLabel key={i.id} locationId={i.label.locationId} locationName={i.label.locationName} businessName={i.label.businessName} /> : last4(i.ghlAccountId),
            i.pipeline,
            i.kind,
            i.stage ?? "—",
            <span key="s" className={i.status === "failed" ? "text-red-300" : i.status === "pending" ? "text-gold" : "text-white/70"}>{i.status}</span>,
            i.attempts,
            i.lastError ?? "—",
          ])}
          empty="No intents recorded yet."
        />
      </Section>

      <Section title="Stage-change and invoice events" note="GHL → server webhooks (last 20). An event with an error is retried by the replay job (up to 5 attempts).">
        <Table
          head={["Received (Denver)", "Source", "What", "Account", "Processed", "Attempts", "Note / error"]}
          rows={ghlEvents.map((e) => [
            fmtDenver(e.receivedAt),
            e.source,
            e.summary,
            e.label ? <AccountLabel key={e.id} locationId={e.label.locationId} locationName={e.label.locationName} businessName={e.label.businessName} /> : "—",
            e.processedAt ? fmtDenver(e.processedAt) : <span key="p" className="text-gold">pending</span>,
            e.attempts,
            e.lastError ? <span key="n" className={e.processedAt ? "text-white/50" : "text-red-300"}>{e.lastError}</span> : "—",
          ])}
          empty="No stage-change or invoice events received yet."
        />
      </Section>

      <Section title="Unpaid subscriptions (informational)" note="Subscriptions GHL currently reports as unpaid, from the nightly sub_sweep state. No engine event is emitted for unpaid.">
        <p className="px-4 pt-3 text-sm text-white/80">{unpaid.length} unpaid {unpaid.length === 1 ? "subscription" : "subscriptions"}</p>
        <Table
          head={["Account", "Subscription", "Plan", "Last seen (Denver)"]}
          rows={unpaid.map((u) => [u.label ? <AccountLabel key={u.subscriptionId} locationId={u.label.locationId} locationName={u.label.locationName} businessName={u.label.businessName} /> : <span key={u.subscriptionId} className="text-white/50">no member account</span>, last4(u.subscriptionId), u.name ?? "—", fmtDenver(u.lastSeenAt)])}
          empty="None — the sweep has not recorded any unpaid subscriptions."
        />
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
