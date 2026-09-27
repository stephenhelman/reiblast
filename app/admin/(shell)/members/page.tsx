import Link from "next/link";
import AccountLabel from "@/components/admin/AccountLabel";
import { ExportButton, Money, SortHeader } from "@/components/admin/controls";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import { fmtDenverDate } from "@/lib/admin/format";
import { paramsOf, parseMemberFilters } from "@/lib/admin/filters";
import { adminHref } from "@/lib/admin/links";
import { pageCtx } from "@/lib/admin/pageCtx";
import { fmtMoney } from "@/lib/billing/reports/money";
import { loadMembers, matchesState, sortMembers, STATE_FILTERS } from "@/lib/billing/reports/members";
import { accountLabel } from "@/lib/admin/accountLabel";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = { all: "All", not_seeded: "Not seeded" };

export default async function MembersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, base, hq, now } = await pageCtx();
  const { state, sort, dir } = parseMemberFilters(paramsOf(searchParams));
  const { rows: all } = await loadMembers(db, hq, now);
  const counts = new Map<string, number>(STATE_FILTERS.map((s) => [s, all.filter((r) => matchesState(r, s)).length]));
  const labelOf = (r: (typeof all)[number]) => { const l = accountLabel({ locationId: r.locationId, locationName: r.locationName, businessName: r.businessName }, hq); return `${l.name} ${l.suffix ?? ""}`; };
  const rows = sortMembers(all.filter((r) => matchesState(r, state)), sort, dir, labelOf);
  const keep = { state: state === "all" ? undefined : state };
  const h = (key: string, text: string) => <SortHeader key={key} base={base} path="/members" params={keep} sortKey={key} label={text} current={sort} dir={dir} />;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle sub={`${rows.length} of ${all.length} member accounts. The internal owner account is excluded.`}>Members</PageTitle>
        <ExportButton view="members" params={{ ...keep, sort, dir }} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATE_FILTERS.map((s) => (
          <Link key={s} href={adminHref(base, "/members", { state: s === "all" ? undefined : s, sort, dir })} className={`rounded-lg border px-3 py-1.5 text-sm ${state === s ? "border-gold text-gold" : "border-border-default text-white/70 hover:text-white"}`}>
            {STATE_LABEL[s] ?? s.replace("_", " ")} <span className="text-white/40">{counts.get(s)}</span>
          </Link>
        ))}
      </div>

      <Section
        title="Members"
        note={`Covered until = manual override (GhlAccount.coreCoveredUntil + note); it ends at 00:00 Denver on that date. Expected next charge (≈) is an estimate: latest succeeded core payment + 1 month. Strikes are User.warningCount, live (pre-cutover). Usage and recharges are the last 30 days.`}
      >
        <Table
          head={[h("label", "Member"), h("state", "State"), "Pause reason", "Legacy", h("covered", "Covered until"), "Expected next charge (≈)", h("strikes", "Strikes (live, pre-cutover)"), h("balance", "Balance"), h("lastCore", "Last core payment"), h("usage30", "30-day usage"), h("recharges30", "30-day recharges")]}
          rows={rows.map((r) => [
            <Link key="a" href={adminHref(base, `/members/${r.accountId}`)} className="hover:text-gold"><AccountLabel locationId={r.locationId} locationName={r.locationName} businessName={r.businessName} /></Link>,
            r.billingState ?? <span key="s" className="text-gold">not seeded</span>,
            r.pauseReason?.replace("_", " ") ?? "—",
            r.legacyUnreconciled ? <span key="l" className="text-gold">yes</span> : "—",
            r.coveredUntil ? <span key="c">{fmtDenverDate(r.coveredUntil)}{r.coverageNote && <span className="block text-xs text-white/40">{r.coverageNote}</span>}</span> : "—",
            r.expectedNextCharge ? <span key="e">≈ {fmtDenverDate(r.expectedNextCharge)}{r.coverageOverrideApplies && <span className="ml-2 rounded border border-gold/50 px-1.5 text-xs text-gold">override applies</span>}</span> : r.coverageOverrideApplies ? <span key="e" className="rounded border border-gold/50 px-1.5 text-xs text-gold">override applies</span> : "—",
            r.strikes || "—",
            r.balance ? <Money key="b" neg={Number(r.balance.balance ?? 0) < 0}>{r.balance.status === "ok" ? fmtMoney(r.balance.balance) : r.balance.status}</Money> : "—",
            r.lastCorePaymentAt ? fmtDenverDate(r.lastCorePaymentAt) : "—",
            <Money key="u">{fmtMoney(r.usage30)}</Money>,
            <Money key="rc">{fmtMoney(r.recharges30)}</Money>,
          ])}
          empty="No members match."
        />
      </Section>
    </div>
  );
}
