import AccountLabel from "@/components/admin/AccountLabel";
import { BadgeRow, PageTitle, Section, Table } from "@/components/admin/ui";
import { fmtUsd } from "@/lib/admin/format";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";
import { getBillingDb } from "@/lib/billing/db";
import { buildBadges, getBalancesHealth, getDataQuality, getDbSize, getJobsHealth, getMemberOverview } from "@/lib/billing/reports/health";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireOwnerOrRedirect();
  const db = await getBillingDb();
  const [jobs, quality, balances, dbSize, members] = await Promise.all([getJobsHealth(db), getDataQuality(db), getBalancesHealth(db), getDbSize(db), getMemberOverview(db)]);
  const badges = buildBadges({ jobs, quality, balances, db: dbSize });

  return (
    <div>
      <PageTitle sub="REIblast billing — health at a glance. Member accounts only; the internal owner account is excluded.">Overview</PageTitle>
      <div className="mt-6">
        <BadgeRow badges={badges} />
      </div>

      <Section title="Members by billing state" note={`${members.memberTotal} member accounts. “Not yet seeded” = billingState is still null.`}>
        <Table head={["Billing state", "Accounts"]} rows={members.billingStates.map((s) => [s.state, s.count])} empty="No member accounts." />
      </Section>

      <Section title="Negative wallet balances" note={`Latest snapshot per location${balances.negative.length > 10 ? ` — most negative 10 of ${balances.negative.length}` : ""}. Full list on Health.`}>
        <Table
          head={["Location", "Balance", "Snapshot day"]}
          rows={balances.negative.slice(0, 10).map((r) => [<AccountLabel key={r.locationId} locationId={r.locationId} locationName={r.locationName} businessName={r.businessName} />, fmtUsd(r.balance as string), r.takenOn])}
          empty="None."
        />
      </Section>

      <Section title="Legacy" note="Accounts flagged legacyUnreconciled (billing history not yet reconciled).">
        <p className="px-6 py-4 text-sm text-white/80">{members.legacyUnreconciled} member accounts</p>
      </Section>

      <Section title="Strikes — live (pre-cutover)" note="From User.warningCount, the value the running app enforces today. Only users with at least one strike are listed.">
        <Table head={["Strikes", "Users"]} rows={members.strikeCounts.map((s) => [s.warningCount, s.users])} empty="No users with strikes." />
      </Section>
    </div>
  );
}
