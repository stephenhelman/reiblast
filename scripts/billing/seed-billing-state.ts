/**
 * Seed GhlAccount.billingState from the pull #1 subscriptions JSON + trailing-30-Denver-day wallet activity.
 *
 *   PRISMA_TARGET=dev npx tsx scripts/billing/seed-billing-state.ts <subscriptions.json>                              # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/billing/seed-billing-state.ts <subscriptions.json> --apply                      # write
 *   optional: --wallet-dir=<dir>  fallback for a location with NO WalletTransaction rows at all (see below)
 *   optional: --emit-json=<path>  writes the final per-account state (for reporting)
 *
 * Uses the most recent subscription per contact (by createdAt). DB state wins:
 * an account with a non-null billingState is never written to (listed as a skip).
 *
 *   trialing         → trial (trialOffer/trialEndsAt only if the name matches /\d+\s*Day Trial/i)
 *   active           → active
 *   unpaid           → payment_failed
 *   paused | expired | canceled | incomplete_expired, with a locationId:
 *       ≥1 WalletTransaction row in the trailing 30 Denver days → paused / non_payment / legacyUnreconciled
 *       none in that window (but the location has WalletTransaction history at all) → churned / legacyUnreconciled
 *       NO WalletTransaction rows for the location at all → --wallet-dir fallback (one <locationId>.json per location,
 *         { rows: [...] }, from the old August wallet pull) if given, else left null (listed)
 *     without a locationId → left null (listed)
 */
import fs from "node:fs";
import path from "node:path";
import { BillingState, PauseReason } from "@prisma/client";
import { classifyLegacySubscription, trailingActivityWindowStart } from "../../lib/billing/seedBillingState";
import { connect } from "./_cli";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opt = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const file = positional[0];
const walletDir = opt("wallet-dir");
const emitJson = opt("emit-json");
if (!file) throw new Error("usage: seed-billing-state.ts <subscriptions.json> [--wallet-dir=<dir>] [--apply] [--emit-json=<path>]");

const { db: prisma, apply } = await connect();
const windowStart = trailingActivityWindowStart(new Date());
console.log(`Trailing-activity window: WalletTransaction.settlementTime >= ${windowStart.toISOString()} (30 Denver days)`);
if (walletDir) console.log(`--wallet-dir=${walletDir} — fallback only, for a location with no WalletTransaction rows at all\n`);
else console.log();
const last4 = (s: string) => `…${s.slice(-4)}`;
const TRIAL_RE = /\d+\s*Day Trial/i;

type Sub = {
  contactId?: string;
  status: string;
  createdAt: string;
  entitySourceName?: string;
  recurringProduct?: { product?: { name?: string } };
  lineItemDetails?: { name?: string };
  trialEndDate?: string;
};
type Acct = {
  contactId: string;
  locationId: string | null;
  billingState: BillingState | null;
  pauseReason: PauseReason | null;
  legacyUnreconciled: boolean;
  trialOffer: string | null;
  trialEndsAt: Date | null;
};

/** --wallet-dir fallback (old August pull), used ONLY for a location with no WalletTransaction rows at all.
 *  null = unknown (no wallet-dir file for that location either). */
function walletDirActivity(locationId: string): boolean | null {
  if (!walletDir) return null;
  const f = path.join(walletDir, `${locationId}.json`);
  if (!fs.existsSync(f)) return null;
  return (JSON.parse(fs.readFileSync(f, "utf8")).rows?.length ?? 0) > 0;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(file as string, "utf8"));
  const subs: Sub[] = Array.isArray(raw) ? raw : raw.data;
  const byContact = new Map<string, Sub[]>();
  for (const s of subs) if (s.contactId) byContact.set(s.contactId, [...(byContact.get(s.contactId) ?? []), s]);

  const dbAccounts = await prisma.ghlAccount.findMany({ where: { accountType: "member" } });
  const accounts = new Map<string, Acct>();
  let simulated = false;
  if (dbAccounts.length > 0) {
    for (const a of dbAccounts) accounts.set(a.contactId, a);
  } else {
    simulated = true;
    const users = await prisma.user.findMany({
      where: { ghlContactId: { not: null } },
      select: { ghlContactId: true, ghlLocationId: true, status: true },
    });
    for (const u of users) {
      accounts.set(u.ghlContactId as string, {
        contactId: u.ghlContactId as string,
        locationId: u.ghlLocationId,
        billingState: u.status === "suspended" ? BillingState.paused : u.status === "inactive" ? BillingState.inactive : null,
        pauseReason: u.status === "suspended" ? PauseReason.non_payment : null,
        legacyUnreconciled: false,
        trialOffer: null,
        trialEndsAt: null,
      });
    }
    console.log("NOTE: GhlAccount is empty — simulating accounts from User + backfill status rules.\n");
  }

  // Two DB passes over the trailing window's locations, scoped to locations we actually have: which locations have ANY
  // WalletTransaction row (ever), and which have one in the trailing 30 Denver days. Both are grouped once, not per-account.
  const locationIds = [...new Set([...accounts.values()].map((a) => a.locationId).filter((l): l is string => !!l))];
  const [anyRows, recentRows] = await Promise.all([
    prisma.walletTransaction.groupBy({ by: ["scopeKey"], where: { scopeKey: { in: locationIds } } }),
    prisma.walletTransaction.groupBy({ by: ["scopeKey"], where: { scopeKey: { in: locationIds }, settlementTime: { gte: windowStart } } }),
  ]);
  const hasAnyData = new Set(anyRows.map((r) => r.scopeKey));
  const hasRecentActivity = new Set(recentRows.map((r) => r.scopeKey));
  /** true/false from WalletTransaction when the location has any history; else the --wallet-dir fallback; else null (unknown). */
  const activityFor = (locationId: string): boolean | null => (hasAnyData.has(locationId) ? hasRecentActivity.has(locationId) : walletDirActivity(locationId));

  const matched: Record<string, number> = {};
  const unmatched: Record<string, number> = {};
  const multi: string[] = [];
  const skipped: string[] = [];
  const noLocation: string[] = [];
  const noActivityData: string[] = [];
  const offers: Record<string, number> = {};
  const nonTrialNames: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const finalAccts = new Map<string, Acct>([...accounts].map(([k, v]) => [k, { ...v }]));
  const writes: { contactId: string; data: Partial<Acct> }[] = [];

  for (const [cid, list] of byContact) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const used = sorted[0];
    if (list.length > 1) multi.push(`${last4(cid)}: ${list.length} subs [${sorted.map((s) => s.status).join(", ")}] → used ${used.status}`);
    const acct = accounts.get(cid);
    (acct ? matched : unmatched)[used.status] = ((acct ? matched : unmatched)[used.status] ?? 0) + 1;
    if (!acct) continue;

    let data: Partial<Acct> | null = null;
    let outcome = "";
    if (used.status === "trialing") {
      const names = [used.entitySourceName, used.recurringProduct?.product?.name, used.lineItemDetails?.name].filter((n): n is string => !!n);
      const offer = names.find((n) => TRIAL_RE.test(n)) ?? null;
      if (offer) offers[offer] = (offers[offer] ?? 0) + 1;
      else nonTrialNames[names[0] ?? "(no name)"] = (nonTrialNames[names[0] ?? "(no name)"] ?? 0) + 1;
      data = {
        billingState: BillingState.trial,
        trialOffer: offer,
        trialEndsAt: offer && used.trialEndDate ? new Date(used.trialEndDate) : null,
      };
      outcome = "trial";
    } else if (used.status === "active") {
      data = { billingState: BillingState.active };
      outcome = "active";
    } else if (used.status === "unpaid") {
      data = { billingState: BillingState.payment_failed };
      outcome = "payment_failed";
    } else if (["paused", "expired", "canceled", "incomplete_expired"].includes(used.status)) {
      if (!acct.locationId) {
        noLocation.push(`${last4(cid)} (latest sub ${used.status})`);
        outcome = "left null (no locationId)";
      } else {
        const outcomeData = classifyLegacySubscription(activityFor(acct.locationId));
        if (!outcomeData) {
          noActivityData.push(`${last4(acct.locationId)} (latest sub ${used.status})`);
          outcome = "left null (no wallet data — no WalletTransaction history and no --wallet-dir file)";
        } else {
          data = { billingState: outcomeData.billingState, pauseReason: outcomeData.pauseReason, legacyUnreconciled: outcomeData.legacyUnreconciled };
          outcome = outcomeData.label;
        }
      }
    }
    if (!data) { outcomes[outcome || `no rule (${used.status})`] = (outcomes[outcome || `no rule (${used.status})`] ?? 0) + 1; continue; }
    if (acct.billingState) {
      skipped.push(`${last4(cid)}: latest sub ${used.status} → would be ${data.billingState}, but account already ${acct.billingState} (DB wins)`);
      outcomes["skipped: DB state wins"] = (outcomes["skipped: DB state wins"] ?? 0) + 1;
      continue;
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    writes.push({ contactId: cid, data });
    Object.assign(finalAccts.get(cid) as Acct, data);
  }

  const noSub = [...accounts.keys()].filter((c) => !byContact.has(c));

  console.log(`Subscriptions: ${subs.length} across ${byContact.size} contacts`);
  console.log("Matched to a GhlAccount, by latest-sub status:", matched);
  console.log("Unmatched (no GhlAccount), by latest-sub status:", unmatched);
  console.log(`GhlAccounts with no subscription: ${noSub.length}`);
  console.log(`Contacts with multiple subscriptions: ${multi.length}`);
  for (const m of multi) console.log(`  ${m}`);
  console.log(`\nSkipped — DB state wins: ${skipped.length}`);
  for (const s of skipped) console.log(`  ${s}`);
  console.log(`\nLeft null, no locationId: ${noLocation.length}`);
  for (const s of noLocation) console.log(`  ${s}`);
  console.log(`Left null, no wallet activity data for location: ${noActivityData.length}`);
  for (const s of noActivityData) console.log(`  ${s}`);
  console.log("\ntrialOffer values set:", offers);
  console.log("Trialing subs NOT matching a trial pattern (trialOffer null):", nonTrialNames);
  console.log("Outcomes:", outcomes);
  console.log(`\n${apply ? "Applying" : "Would apply"} ${writes.length} writes`);

  const dist: Record<string, number> = {};
  for (const a of finalAccts.values()) dist[a.billingState ?? "null"] = (dist[a.billingState ?? "null"] ?? 0) + 1;
  console.log(`\nFinal billingState distribution (${finalAccts.size} accounts):`, dist);
  console.log("legacyUnreconciled = true:", [...finalAccts.values()].filter((a) => a.legacyUnreconciled).length);

  if (emitJson) {
    fs.writeFileSync(emitJson, JSON.stringify([...finalAccts.values()].map((a) => ({ ...a, contactId: undefined, contact4: last4(a.contactId) }))));
  }

  if (apply && simulated) {
    console.log("Refusing --apply: no GhlAccount rows exist. Run the backfill first.");
    process.exitCode = 1;
  } else if (apply) {
    for (const w of writes) await prisma.ghlAccount.update({ where: { contactId: w.contactId }, data: w.data });
    console.log("Done.");
  }
}

main().finally(() => prisma.$disconnect());
