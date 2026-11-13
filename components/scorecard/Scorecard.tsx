import { MIN_VARIANT_ENTERED, type ScorecardData, type WithRates } from "@/lib/scorecard/data";

/**
 * Read-only scorecard body. Pure presentation of ScorecardData — it knows nothing about sessions or locations, so the tools-session
 * page and the signed-link view render the identical component.
 */

const nf = new Intl.NumberFormat("en-US");
const num = (n: number) => nf.format(n);
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {hint && <p className="mb-4 mt-1 text-sm text-gray">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

const Card = ({ children, highlight = false }: { children: React.ReactNode; highlight?: boolean }) => (
  <div className={`rounded-xl border bg-surface p-4 sm:p-5 ${highlight ? "border-gold" : "border-border-default"}`}>{children}</div>
);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-gray">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-silver tabular-nums">{sub}</p>}
    </div>
  );
}

function StatRow({ s }: { s: WithRates }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Sent" value={num(s.entered)} />
      <Stat label="Replies" value={num(s.replied)} sub={`${pct(s.replyRate)} reply rate`} />
      <Stat label="Errors" value={num(s.errored)} sub={`${pct(s.errorRate)} error rate`} />
    </div>
  );
}

function MonthBlock({ title, stats, note }: { title: string; stats: WithRates; note?: string }) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-silver">{title}</p>
      <StatRow s={stats} />
      {note && <p className="mt-3 text-xs text-gray">{note}</p>}
    </Card>
  );
}

export default function Scorecard({ data }: { data: ScorecardData }) {
  if (data.empty) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-white">No campaign data yet</h2>
        <p className="mt-2 text-sm text-gray">
          Your scorecard fills in as contacts enter your SMS campaigns and reply. Check back after your first campaign sends.
        </p>
      </Card>
    );
  }

  const { month } = data;
  return (
    <div>
      <Section title="All campaigns" hint="Everything sent from your account so far.">
        <Card><StatRow s={data.totals} /></Card>
      </Section>

      <Section title="This month vs last" hint="Month-end snapshots, compared with your live totals.">
        {month.kind === "no_snapshot" ? (
          <Card>
            <p className="text-sm text-silver">
              Month-over-month comparison starts after your first month-end snapshot (the 1st of next month). Until then, here are your all-time totals.
            </p>
            <div className="mt-4"><StatRow s={month.allTime} /></div>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <MonthBlock
              title={month.thisMonth.spansMonths && month.thisMonth.since ? `Since ${monthName(month.thisMonth.since)}` : `This month (${monthName(month.thisMonth.month)})`}
              stats={month.thisMonth.stats}
              note={month.thisMonth.spansMonths ? "A recent month-end snapshot is missing, so this covers more than one month." : undefined}
            />
            {month.lastMonth ? (
              <MonthBlock
                title={`Last month (${monthName(month.lastMonth.month)})`}
                stats={month.lastMonth.stats}
                note={month.lastMonth.includesEarlier ? "Your first snapshot — includes all activity up to that month-end." : undefined}
              />
            ) : (
              <Card><p className="text-sm text-gray">Last month&apos;s snapshot isn&apos;t available.</p></Card>
            )}
          </div>
        )}
      </Section>

      {data.lists.length > 0 && (
        <Section title="Lists" hint="One card per list you've texted.">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.lists.map((l) => (
              <Card key={`${l.listType}|${l.listName}`}>
                <p className="text-xs uppercase tracking-wide text-gold">{l.listType}</p>
                <p className="mb-3 mt-0.5 break-words font-medium text-white">{l.listName || "Unnamed list"}</p>
                <StatRow s={l} />
              </Card>
            ))}
          </div>
        </Section>
      )}

      {data.openers.length > 0 && (
        <Section title="Openers" hint={`Variants side by side, per list type. A leader is only called once every variant has ${MIN_VARIANT_ENTERED}+ sent.`}>
          <div className="grid gap-4">
            {data.openers.map((g) => (
              <Card key={g.listType}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">{g.listType}</p>
                  {!g.enoughData && <span className="text-xs text-gray">Not enough data</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {g.variants.map((v) => {
                    const lead = g.leader === v.variant;
                    return (
                      <div key={v.variant} className={`rounded-lg border p-3 ${lead ? "border-gold bg-surface-2" : "border-border-default bg-surface-2"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm text-silver">{v.label}</p>
                          {lead && <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase text-black">Leader</span>}
                        </div>
                        <p className={`mt-1 text-xl font-semibold tabular-nums ${lead ? "text-gold" : "text-white"}`}>{pct(v.replyRate)}</p>
                        <p className="text-xs text-gray tabular-nums">{num(v.replied)} replies / {num(v.entered)} sent</p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Replies by step" hint="Which message in the sequence people answer, and where sends fail.">
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray">
                <th className="pb-2 font-medium">Step</th>
                <th className="pb-2 text-right font-medium">Replies</th>
                <th className="pb-2 text-right font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {data.steps.map((s) => (
                <tr key={s.step} className="border-t border-border-default">
                  <td className="py-2 text-silver">SMS {s.step}</td>
                  <td className="py-2 text-right text-white tabular-nums">{num(s.replied)}</td>
                  <td className="py-2 text-right text-white tabular-nums">{num(s.errored)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      {data.unlabeled && (
        <Section title="Unlabeled" hint="Contacts that entered without a list type.">
          <Card>
            <StatRow s={data.unlabeled} />
            <p className="mt-3 text-xs text-gray">Pick a List Type when you export your list so these show up under the right campaign.</p>
          </Card>
        </Section>
      )}

      {data.categories && (
        <Section title="Reply categories" hint="How your replies were sorted.">
          <Card>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Interested" value={num(data.categories.interested)} />
              <Stat label="Not now" value={num(data.categories.notNow)} />
              <Stat label="Needs reply" value={num(data.categories.needsReply)} />
              <Stat label="Wrong number" value={num(data.categories.wrongNumber)} />
              <Stat label="Opt-out" value={num(data.categories.optOut)} />
              <Stat label="Other" value={num(data.categories.other)} />
            </div>
          </Card>
        </Section>
      )}

      <Section title="Cost per lead">
        <div className="rounded-xl border border-dashed border-border-default bg-surface p-5 text-center">
          <p className="font-medium text-silver">Coming soon</p>
          <p className="mt-1 text-sm text-gray">See what each interested lead costs you.</p>
        </div>
      </Section>
    </div>
  );
}
