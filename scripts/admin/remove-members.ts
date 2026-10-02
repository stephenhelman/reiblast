/**
 * Remove members (User + GhlAccount + every dependent row) by GHL contact id. Dry-run by default.
 *
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/admin/remove-members.ts --i-mean-production --contact-id=<id> [--contact-id=<id> ...]
 *   ... add --apply to delete
 *
 * Production guard is the shared connect() (BILLING_DB_TARGET=prod + --i-mean-production + typed host). The dry-run prints a count per
 * table. A contact with ANY succeeded BillingLedgerEntry with amount > 0 is refused (money moved). --apply deletes every removable
 * contact's rows in ONE transaction (dependents → GhlAccount → User) and aborts the whole transaction on anything unexpected.
 * Logic + the dependency registry: lib/admin/removeMembers.ts.
 */
import { connect } from "../billing/_cli";
import { executeRemoval, planRemoval, unexpectedReferences, type Plan } from "../../lib/admin/removeMembers";

const contactIds = process.argv.filter((a) => a.startsWith("--contact-id=")).map((a) => a.slice("--contact-id=".length).trim()).filter(Boolean);
if (contactIds.length === 0) throw new Error("usage: remove-members.ts --contact-id=<ghl contact id> [--contact-id=...] [--apply]");
const unknown = unexpectedReferences();
if (unknown.length) throw new Error(`Refusing to run: the schema has models referencing User/GhlAccount that this tool does not handle: ${unknown.join(", ")}`);

const { db: prisma, apply } = await connect();

async function main() {
  const removable: Extract<Plan, { ok: true }>[] = [];
  for (const id of [...new Set(contactIds)]) {
    const p = await planRemoval(prisma as never, id);
    console.log(`\n=== contact ${id} ===`);
    if (!p.ok) {
      console.log(`REFUSED: ${p.refusal.reason}`);
      continue;
    }
    console.log(`User ${p.ctx.userId} (${p.email ?? "no email"}), GhlAccount ${p.ctx.accountId ?? "— none —"}, locations: ${p.ctx.locationIds.join(", ") || "—"}`);
    for (const c of p.counts) if (c.count > 0) console.log(`  ${String(c.count).padStart(6)}  ${c.table}  [${c.by}]`);
    console.log(`  ${String(p.total).padStart(6)}  TOTAL rows (${p.counts.filter((c) => c.count === 0).length} tables with none)`);
    removable.push(p);
  }
  console.log(`\n${removable.length} of ${new Set(contactIds).size} contact(s) removable.`);
  if (!apply) return console.log("Dry-run: nothing deleted. Re-run with --apply.");
  if (removable.length === 0) return console.log("Nothing to delete.");

  const deleted = await prisma.$transaction(async (tx) => {
    const all: { contactId: string; rows: { table: string; deleted: number }[] }[] = [];
    for (const p of removable) all.push({ contactId: p.ctx.contactId, rows: await executeRemoval(tx as never, p.ctx) });
    return all;
  }, { timeout: 120_000, maxWait: 30_000 });
  for (const d of deleted) {
    console.log(`\nDeleted for ${d.contactId}:`);
    for (const r of d.rows) if (r.deleted > 0) console.log(`  ${String(r.deleted).padStart(6)}  ${r.table}`);
  }
  console.log("\nDone (one transaction).");
}

main().finally(() => prisma.$disconnect());
