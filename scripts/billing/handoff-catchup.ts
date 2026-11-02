/**
 * Clients handoff for members who reached A2P Approved while their billingState was null (GhlEvent "client_handoff_review").
 * Run AFTER sub_sweep (or a payment event) has seeded their state. Dry-run by default: prints who WOULD be handed off and into which
 * Clients stage, and who is still unseeded. --apply performs the handoffs and requires CLIENT_HANDOFF=live.
 *
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/handoff-catchup.ts --i-mean-production            # report only
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod CLIENT_HANDOFF=live npx tsx scripts/billing/handoff-catchup.ts --i-mean-production --apply
 */
import { connect } from "./_cli";
import { planCatchup, runCatchup } from "../../lib/billing/handoffCatchup";

const { db: prisma, apply } = await connect();
const last4 = (s: string) => `…${s.slice(-4)}`;

async function main() {
  const plan = await planCatchup(prisma);
  const by = (st: string) => plan.filter((r) => r.status === st);
  console.log(`client_handoff_review accounts still awaiting a handoff: ${plan.length}`);
  for (const r of plan) console.log(`  ${r.ghlAccountId} contact ${last4(r.contactId)}  state=${r.billingState ?? "null"}  ${r.status === "ready" ? `→ Clients stage "${r.stage}"` : r.status === "unseeded" ? "UNSEEDED — run sub_sweep --apply first" : "not at A2P Approved — skipped"}`);
  console.log(`\nWould hand off: ${by("ready").length}   still unseeded: ${by("unseeded").length}   skipped: ${by("not_at_a2p_approved").length}`);
  if (!apply) return console.log("Dry run — nothing sent. Re-run with --apply (and CLIENT_HANDOFF=live) to hand off the ready accounts.");
  const { results } = await runCatchup(prisma);
  for (const r of results) console.log(`  ${r.ghlAccountId}: ${r.result.status}${"sent" in r.result ? ` (${r.result.sent})` : ""}`);
  console.log(`Handed off ${results.filter((r) => r.result.status === "handed_off").length} of ${results.length}.`);
}

main().finally(() => prisma.$disconnect());
