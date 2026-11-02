import { Notice, btnCls, inputCls, labelCls } from "@/components/admin/statementUi";
import { PageTitle, Section, Table } from "@/components/admin/ui";
import Card from "@/components/shared/Card";
import { fmtCents } from "@/lib/admin/format";
import { paramsOf } from "@/lib/admin/filters";
import { pageCtx } from "@/lib/admin/pageCtx";
import { RATE_KEYS } from "@/lib/admin/statementForms";
import { addFixedCostAction, addRateAction } from "../statement-actions";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function SettingsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { db, now } = await pageCtx();
  const p = paramsOf(searchParams);
  const [rates, costs] = await Promise.all([db.settingRate.findMany({ orderBy: [{ key: "asc" }, { effectiveFrom: "desc" }] }), db.fixedCost.findMany({ orderBy: [{ name: "asc" }, { effectiveFrom: "desc" }] })]);
  const today = day(now);
  // The row in force today per key / name is the first one whose date has passed (lists are newest-first).
  const activeRate = new Set<string>(), activeCost = new Set<string>();
  const rateRows = rates.map((r) => { const active = day(r.effectiveFrom) <= today && !activeRate.has(r.key); if (active) activeRate.add(r.key); return { r, active }; });
  const costRows = costs.map((c) => { const active = day(c.effectiveFrom) <= today && !activeCost.has(c.name); if (active) activeCost.add(c.name); return { c, active }; });
  const nextMonth = `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)}`;

  return (
    <div>
      <PageTitle sub="Dated settings. History is never edited: to change a number, add a new row effective the 1st of a month. A statement uses the row in force on the first day of its month.">Settings</PageTitle>
      <Notice notice={p.get("notice")} error={p.get("error")} />

      <Section title="Rates" note="Kurv fee rates, the AVS ratio (an estimate) and the partner split. Fractions: 0.029 = 2.9%.">
        <Table
          head={["Key", "Value", "Effective from", "In force", "Note"]}
          rows={rateRows.map(({ r, active }) => [<code key="k" className="text-xs">{r.key}</code>, <span key="v" className="tabular-nums">{r.value.toString()}</span>, day(r.effectiveFrom), active ? <span key="a" className="text-emerald-300">now</span> : day(r.effectiveFrom) > today ? "scheduled" : "superseded", <span key="n" className="text-xs text-white/50">{r.note ?? ""}</span>])}
          empty="No rates yet. Run scripts/billing/seed-statement.ts."
        />
      </Section>
      <Card className="mt-4">
        <h3 className="text-sm font-bold text-white">Add a rate row</h3>
        <form action={addRateAction} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className={labelCls}>Rate
            <select name="key" className={inputCls}>{RATE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </label>
          <label className={labelCls}>Value<input name="value" inputMode="decimal" required placeholder="0.029" className={inputCls} /></label>
          <label className={labelCls}>Effective from (1st of month)<input type="date" name="effectiveFrom" required defaultValue={nextMonth} className={inputCls} /></label>
          <label className={labelCls}>Note<input name="note" maxLength={200} className={inputCls} /></label>
          <div className="flex items-end"><button type="submit" className={btnCls}>Add row</button></div>
        </form>
      </Card>

      <Section title="Fixed monthly costs" note="Charged to the statement every month. GHL agency plan and Authorize.net. Stephen's own costs (Railway, domains, …) are not on the statement.">
        <Table
          head={["Name", "Monthly", "Effective from", "In force"]}
          rows={costRows.map(({ c, active }) => [<code key="n" className="text-xs">{c.name}</code>, <span key="a" className="tabular-nums">{fmtCents(c.monthlyAmountCents)}</span>, day(c.effectiveFrom), active ? <span key="x" className="text-emerald-300">now</span> : day(c.effectiveFrom) > today ? "scheduled" : "superseded"])}
          empty="No fixed costs yet."
        />
      </Section>
      <Card className="mt-4">
        <h3 className="text-sm font-bold text-white">Add a fixed-cost row</h3>
        <form action={addFixedCostAction} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className={labelCls}>Name<input name="name" list="cost-names" required placeholder="ghl_agency_plan" className={inputCls} /><datalist id="cost-names">{[...new Set(costs.map((c) => c.name))].map((n) => <option key={n} value={n} />)}</datalist></label>
          <label className={labelCls}>Monthly amount ($; 0 ends a cost)<input name="amount" inputMode="decimal" required className={inputCls} /></label>
          <label className={labelCls}>Effective from (1st of month)<input type="date" name="effectiveFrom" required defaultValue={nextMonth} className={inputCls} /></label>
          <div className="flex items-end"><button type="submit" className={btnCls}>Add row</button></div>
        </form>
        <p className="mt-3 text-xs text-white/40">Only <code>ghl_agency_plan</code> and <code>authorize_net</code> are read by the statement today.</p>
      </Card>
    </div>
  );
}
