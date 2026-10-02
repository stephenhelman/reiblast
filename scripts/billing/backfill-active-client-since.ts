/**
 * Backfill GhlAccount.activeClientSince for members who already have an opportunity in the Clients pipeline
 * (GHL_CLIENTS_PIPELINE_ID). Read-only GHL lookup, one GET per member without activeClientSince. Dry-run by default.
 *
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-active-client-since.ts --i-mean-production --estimate-only
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-active-client-since.ts --i-mean-production            # lookups, no writes
 *   DATABASE_URL="$PROD" BILLING_DB_TARGET=prod npx tsx scripts/billing/backfill-active-client-since.ts --i-mean-production --apply
 *
 * --estimate-only prints the member count and GET-call estimate and exits BEFORE any GHL call. activeClientSince is set to the
 * opportunity's creation time when GHL returns one, else now. A lookup that errors is listed and never treated as "no card".
 */
import { connect } from "./_cli";
import { lookupClientsOpportunity, pendingMembers, runActiveClientBackfill } from "../../lib/billing/activeClientBackfill";

const PAUSE_MS = 250;
const { db: prisma, apply } = await connect();
const last4 = (s: string) => `…${s.slice(-4)}`;

async function main() {
  const members = await pendingMembers(prisma);
  const states: Record<string, number> = {};
  for (const m of members) states[m.billingState ?? "null"] = (states[m.billingState ?? "null"] ?? 0) + 1;
  console.log(`Members without activeClientSince: ${members.length}`, states);
  console.log(`Estimate: ${members.length} read-only GHL GET calls (opportunities/search), ~${Math.ceil((members.length * (PAUSE_MS + 300)) / 1000)} s at ${PAUSE_MS} ms spacing. No writes${apply ? " until the lookups finish" : ""}.`);
  if (process.argv.includes("--estimate-only")) return;

  const r = await runActiveClientBackfill(prisma, {
    apply,
    lookup: (c) => lookupClientsOpportunity(c),
    pauseMs: PAUSE_MS,
    onProgress: (d, t) => { if (d % 25 === 0 || d === t) console.log(`  looked up ${d}/${t}`); },
  });
  const byState: Record<string, number> = {};
  for (const w of r.withCard) byState[w.billingState ?? "null"] = (byState[w.billingState ?? "null"] ?? 0) + 1;
  console.log(`\nWith a Clients-pipeline opportunity: ${r.withCard.length}`, byState);
  console.log(`Without one (stay in onboarding routing): ${r.withoutCard}`);
  console.log(`Lookup errors (NOT treated as "no card"): ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ${last4(e.contactId)}: ${e.error}`);
  const nullState = r.withCard.filter((w) => !w.billingState).length;
  if (nullState) console.log(`NOTE: ${nullState} of the handed-off members have a null billingState (seed them — B2 — before the engine goes live).`);
  console.log(`\n${apply ? `Applied ${r.applied}` : `Would set activeClientSince on ${r.withCard.length}`} member(s).${apply ? "" : " Re-run with --apply."}`);
}

main().finally(() => prisma.$disconnect());
